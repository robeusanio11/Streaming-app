import fs from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { promisify } from 'node:util'
import type { Channel } from '../shared/channels.js'
import type { Programme } from '../shared/epg.js'
import { config } from './config.js'
import { safeFetch } from './net.js'
import { parseXmltv } from './xmltv.js'

const gunzip = promisify(zlib.gunzip)

/*
 * Where guide data comes from
 * ---------------------------
 * iptv-org's guides.json says which website has listings for each channel. It no longer links to
 * any hosted XMLTV files. One of those websites, i.mjh.nz, publishes ready-made XMLTV files on
 * GitHub (Pluto TV, Plex, Roku, Samsung TV Plus, PBS and more). guides.json gives the file and the
 * channel id inside it ("PlutoTV/us#<id>"), so those channels can be matched without scraping.
 *
 * Extra XMLTV URLs (EPG_URLS, the playlist's x-tvg-url, or the user's settings) are matched by
 * tvg-id first, then by channel name.
 */

interface GuideRef {
  feed: string | null
  /** e.g. "PlutoTV/us" */
  path: string
  xmltvId: string
}

type Mapping = Record<string, GuideRef[]>

interface LoadedGuide {
  loadedAt: number
  window: { from: number; to: number }
  programmes: Map<string, Programme[]>
  /** Normalised display name to XMLTV channel id. Used only for extra sources. */
  byName: Map<string, string>
  ids: Set<string>
}

const MAPPING_SITE = 'i.mjh.nz'
const MAPPING_TTL = 24 * 3600_000
const GUIDE_TTL = 3 * 3600_000
const MAX_GUIDE_BYTES = 200 * 1024 * 1024

let mapping: { loadedAt: number; data: Mapping } | null = null
let mappingJob: Promise<Mapping> | null = null
const guides = new Map<string, LoadedGuide>()
const guideJobs = new Map<string, Promise<LoadedGuide>>()
/** Recent download failures, so a missing or unreachable file isn't retried on every request. */
const guideFailures = new Map<string, { at: number; message: string }>()
const FAILURE_TTL = 10 * 60_000

export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(hd|sd|fhd|uhd|4k|tv|channel)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

function splitTvgId(tvgId: string): { base: string; feed: string | null } {
  const at = tvgId.indexOf('@')
  return at < 0 ? { base: tvgId, feed: null } : { base: tvgId.slice(0, at), feed: tvgId.slice(at + 1) }
}

async function fetchBuffer(url: string, timeoutMs = 120_000): Promise<Buffer> {
  const res = await safeFetch(url, {
    headers: { 'User-Agent': config.defaultUserAgent, 'Accept-Encoding': 'gzip' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
  const length = Number(res.headers.get('content-length') ?? 0)
  if (length > MAX_GUIDE_BYTES) throw new Error(`${url} is too large (${length} bytes)`)
  let buf = Buffer.from(await res.arrayBuffer())
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = await gunzip(buf)
  return buf
}

async function downloadMapping(): Promise<Mapping> {
  let lastError: unknown
  for (const url of config.guidesJsonUrls) {
    try {
      const rows = JSON.parse((await fetchBuffer(url)).toString('utf8')) as Array<{
        channel: string | null
        feed: string | null
        site: string
        site_id: string
      }>
      const data: Mapping = {}
      for (const r of rows) {
        if (r.site !== MAPPING_SITE || !r.channel) continue
        const hash = r.site_id.indexOf('#')
        if (hash < 0) continue
        ;(data[r.channel] ??= []).push({ feed: r.feed, path: r.site_id.slice(0, hash), xmltvId: r.site_id.slice(hash + 1) })
      }
      return data
    } catch (err) {
      lastError = err
      console.warn(`[epg] could not load ${url}: ${(err as Error).message}`)
    }
  }
  throw lastError ?? new Error('No guides.json URL configured')
}

async function getMapping(): Promise<Mapping> {
  if (mapping && Date.now() - mapping.loadedAt < MAPPING_TTL) return mapping.data
  const file = path.join(config.cacheDir, 'epg-mapping.json')
  if (!mapping) {
    try {
      const disk = JSON.parse(await fs.readFile(file, 'utf8')) as { loadedAt: number; data: Mapping }
      mapping = disk
      if (Date.now() - disk.loadedAt < MAPPING_TTL) return disk.data
    } catch {
      /* no cache yet */
    }
  }
  mappingJob ??= downloadMapping()
    .then(async data => {
      mapping = { loadedAt: Date.now(), data }
      await fs.mkdir(config.cacheDir, { recursive: true })
      await fs.writeFile(file, JSON.stringify(mapping))
      return data
    })
    .finally(() => {
      mappingJob = null
    })
  try {
    return await mappingJob
  } catch (err) {
    if (mapping) return mapping.data // keep using an old copy
    throw err
  }
}

async function loadGuide(url: string): Promise<LoadedGuide> {
  const cached = guides.get(url)
  if (cached && Date.now() - cached.loadedAt < GUIDE_TTL) return cached
  const failed = guideFailures.get(url)
  if (failed && Date.now() - failed.at < FAILURE_TTL) {
    if (cached) return cached
    throw new Error(failed.message)
  }
  let job = guideJobs.get(url)
  if (!job) {
    job = (async () => {
      const started = Date.now()
      const xml = (await fetchBuffer(url)).toString('utf8')
      const window = { from: Date.now() - 6 * 3600_000, to: Date.now() + 36 * 3600_000 }
      const parsed = parseXmltv(xml, window)
      const byName = new Map<string, string>()
      for (const ch of parsed.channels) for (const n of ch.names) if (!byName.has(normalizeName(n))) byName.set(normalizeName(n), ch.id)
      const guide: LoadedGuide = {
        loadedAt: Date.now(),
        window,
        programmes: parsed.programmes,
        byName,
        ids: new Set(parsed.channels.map(c => c.id)),
      }
      guides.set(url, guide)
      guideFailures.delete(url)
      console.log(`[epg] loaded ${url}: ${parsed.programmes.size} channels in ${Date.now() - started}ms`)
      return guide
    })()
      .catch(err => {
        guideFailures.set(url, { at: Date.now(), message: (err as Error).message })
        throw err
      })
      .finally(() => guideJobs.delete(url))
    guideJobs.set(url, job)
  }
  try {
    return await job
  } catch (err) {
    if (cached) return cached
    throw err
  }
}

function mjhUrl(p: string): string {
  return `${config.mjhBaseUrl}/${p}.xml`
}

/** Best guide files for a channel: same feed first, then files for the channel's own country. */
function rankRefs(refs: GuideRef[], tvgId: string): GuideRef[] {
  const { base, feed } = splitTvgId(tvgId)
  const country = /\.([a-z]{2})$/i.exec(base)?.[1]?.toLowerCase()
  const score = (r: GuideRef) => {
    let s = 0
    if (feed && r.feed === feed) s += 100
    const seg = r.path.split('/')
    if (country && seg.includes(country)) s += 10
    if (seg.includes('all')) s += 5
    return s
  }
  return [...refs].sort((a, b) => score(b) - score(a))
}

/** Channels that have built-in guide data, without downloading any guide files. */
export async function builtInCoverage(channels: Channel[]): Promise<string[]> {
  const map = await getMapping()
  return channels.filter(c => map[splitTvgId(c.id).base]).map(c => c.id)
}

/** Ids of channels found in the extra XMLTV sources. Loads those sources. */
export async function extraCoverage(channels: Channel[], sources: string[]): Promise<string[]> {
  const loaded = await Promise.all(sources.map(u => loadGuide(u).catch(() => null)))
  const out: string[] = []
  for (const ch of channels) {
    if (loaded.some(g => g && matchExtra(g, ch))) out.push(ch.id)
  }
  return out
}

function matchExtra(g: LoadedGuide, ch: Channel): string | undefined {
  if (g.ids.has(ch.id)) return ch.id
  const { base } = splitTvgId(ch.id)
  if (g.ids.has(base)) return base
  return g.byName.get(normalizeName(ch.name))
}

function clip(list: Programme[] | undefined, from: number, to: number): Programme[] {
  return (list ?? []).filter(p => p.stop > from && p.start < to)
}

/**
 * Programmes for each channel between `from` and `to`.
 * Built-in i.mjh.nz data is used first, then the extra XMLTV sources.
 */
export async function getProgrammes(
  channels: Channel[],
  from: number,
  to: number,
  extraSources: string[] = [],
): Promise<Record<string, Programme[]>> {
  const result: Record<string, Programme[]> = {}
  let map: Mapping = {}
  try {
    map = await getMapping()
  } catch (err) {
    console.warn('[epg] guide mapping unavailable:', (err as Error).message)
  }

  const plans = channels.map(ch => ({ ch, refs: rankRefs(map[splitTvgId(ch.id).base] ?? [], ch.id).slice(0, 3) }))
  const loaded = new Map<string, LoadedGuide | null>()
  const ensure = (urls: Iterable<string>) =>
    Promise.all(
      [...new Set(urls)]
        .filter(u => !loaded.has(u))
        .map(async u => {
          try {
            loaded.set(u, await loadGuide(u))
          } catch (err) {
            console.warn(`[epg] ${u}: ${(err as Error).message}`)
            loaded.set(u, null)
          }
        }),
    )

  // Try each channel's best file first, then backup files only for channels still missing data,
  // so each file is downloaded once, in parallel, and only when needed.
  let pending = plans
  for (let round = 0; round < 3 && pending.length; round++) {
    const withRef = pending.filter(p => p.refs[round])
    await ensure(withRef.map(p => mjhUrl(p.refs[round].path)))
    for (const { ch, refs } of withRef) {
      const list = clip(loaded.get(mjhUrl(refs[round].path))?.programmes.get(refs[round].xmltvId), from, to)
      if (list.length) result[ch.id] = list
    }
    pending = pending.filter(p => !result[p.ch.id])
  }

  if (pending.length && extraSources.length) {
    await ensure(extraSources)
    for (const { ch } of pending) {
      for (const u of extraSources) {
        const g = loaded.get(u)
        const id = g && matchExtra(g, ch)
        const list = g && id ? clip(g.programmes.get(id), from, to) : []
        if (list.length) {
          result[ch.id] = list
          break
        }
      }
    }
  }
  return result
}
