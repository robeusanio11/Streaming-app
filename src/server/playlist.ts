import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseM3U } from '../shared/m3u.js'
import { groupEntries, type ChannelData } from '../shared/channels.js'
import { config } from './config.js'
import { safeFetch } from './net.js'

const memory = new Map<string, ChannelData>()
const inflight = new Map<string, Promise<ChannelData>>()

function cacheFile(source: string): string {
  const hash = crypto.createHash('sha1').update(source).digest('hex').slice(0, 16)
  return path.join(config.cacheDir, `playlist-${hash}.json`)
}

function isFresh(data: ChannelData): boolean {
  return Date.now() - Date.parse(data.fetchedAt) < config.playlistTtlMs
}

async function download(source: string): Promise<string> {
  if (!/^https?:\/\//i.test(source)) {
    // A local file. Only the server's own PLAYLIST_URL setting can point here.
    return fs.readFile(source, 'utf8')
  }
  const res = await safeFetch(source, {
    headers: { 'User-Agent': config.defaultUserAgent },
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`Playlist download failed: HTTP ${res.status}`)
  return res.text()
}

async function build(source: string): Promise<ChannelData> {
  const text = await download(source)
  if (!text.trimStart().startsWith('#EXTM3U') && !text.includes('#EXTINF')) {
    throw new Error('That URL did not return an M3U playlist')
  }
  const parsed = parseM3U(text)
  const data: ChannelData = {
    sourceUrl: source,
    fetchedAt: new Date().toISOString(),
    epgUrls: parsed.epgUrls,
    channels: groupEntries(parsed.entries),
  }
  await fs.mkdir(config.cacheDir, { recursive: true })
  await fs.writeFile(cacheFile(source), JSON.stringify(data))
  return data
}

async function readDiskCache(source: string): Promise<ChannelData | undefined> {
  try {
    return JSON.parse(await fs.readFile(cacheFile(source), 'utf8')) as ChannelData
  } catch {
    return undefined
  }
}

/**
 * Returns the playlist's parsed channels from memory, then the disk cache, then the network.
 * If a download fails and an old copy exists, the old copy is returned.
 */
export async function getPlaylist(source: string, force = false): Promise<ChannelData> {
  if (!force) {
    const mem = memory.get(source)
    if (mem && isFresh(mem)) return mem
    const disk = await readDiskCache(source)
    if (disk && isFresh(disk)) {
      memory.set(source, disk)
      return disk
    }
  }

  let job = inflight.get(source)
  if (!job) {
    job = build(source).finally(() => inflight.delete(source))
    inflight.set(source, job)
  }
  try {
    const data = await job
    memory.set(source, data)
    return data
  } catch (err) {
    const stale = memory.get(source) ?? (await readDiskCache(source))
    if (stale) {
      console.warn(`[playlist] refresh failed, serving cached copy: ${(err as Error).message}`)
      return stale
    }
    throw err
  }
}
