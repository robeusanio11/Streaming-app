// XMLTV parser that keeps only programmes inside a time window.
// XMLTV is a flat, regular format, so a regex scan is fast and memory-friendly, even for the
// ~40 MB files some guide sources publish.

import type { Programme } from '../shared/epg.js'

export interface XmltvChannel {
  id: string
  names: string[]
  icon?: string
}

export interface ParsedXmltv {
  channels: XmltvChannel[]
  /** Programmes per XMLTV channel id, sorted by start time. */
  programmes: Map<string, Programme[]>
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
}

function text(s: string): string {
  return decodeEntities(stripCdata(s)).trim()
}

/** "20261117030000 +0000" (offset and seconds optional) to epoch ms. */
export function parseXmltvDate(s: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?(?:\s*([+-]\d{2}):?(\d{2})?)?$/.exec(s.trim())
  if (!m) return NaN
  const [, y, mo, d, h = '00', mi = '00', sec = '00', oh, om = '00'] = m
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec)
  if (!oh) return utc
  const sign = oh.startsWith('-') ? -1 : 1
  const offset = sign * (Math.abs(parseInt(oh, 10)) * 60 + parseInt(om, 10)) * 60_000
  return utc - offset
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attrs) ?? new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`).exec(attrs)
  return m ? decodeEntities(m[1]) : undefined
}

function firstTag(body: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(body)
  return m ? text(m[1]) || undefined : undefined
}

const CHANNEL_RE = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/g
const PROGRAMME_RE = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g
const DISPLAY_NAME_RE = /<display-name\b[^>]*>([\s\S]*?)<\/display-name>/g
const CATEGORY_RE = /<category\b[^>]*>([\s\S]*?)<\/category>/g

export function parseXmltv(xml: string, window: { from: number; to: number }): ParsedXmltv {
  const channels: XmltvChannel[] = []
  for (const m of xml.matchAll(CHANNEL_RE)) {
    const id = attr(m[1], 'id')
    if (!id) continue
    const names = [...m[2].matchAll(DISPLAY_NAME_RE)].map(n => text(n[1])).filter(Boolean)
    const iconTag = /<icon\b([^>]*)\/?>/.exec(m[2])
    channels.push({ id, names, icon: iconTag ? attr(iconTag[1], 'src') : undefined })
  }

  const programmes = new Map<string, Programme[]>()
  for (const m of xml.matchAll(PROGRAMME_RE)) {
    const a = m[1]
    const channel = attr(a, 'channel')
    const start = parseXmltvDate(attr(a, 'start') ?? '')
    let stop = parseXmltvDate(attr(a, 'stop') ?? '')
    if (!channel || !Number.isFinite(start)) continue
    if (!Number.isFinite(stop)) stop = start + 30 * 60_000
    if (stop <= window.from || start >= window.to) continue

    const body = m[2]
    const title = firstTag(body, 'title')
    if (!title) continue
    const iconTag = /<icon\b([^>]*)\/?>/.exec(body)
    const onscreen = /<episode-num\b[^>]*system="onscreen"[^>]*>([\s\S]*?)<\/episode-num>/.exec(body)
    const categories = [...new Set([...body.matchAll(CATEGORY_RE)].map(c => text(c[1])).filter(Boolean))]

    const p: Programme = { start, stop, title }
    const sub = firstTag(body, 'sub-title')
    if (sub) p.subtitle = sub
    const desc = firstTag(body, 'desc')
    if (desc) p.description = desc
    if (categories.length) p.categories = categories
    if (onscreen) p.episode = text(onscreen[1])
    const icon = iconTag ? attr(iconTag[1], 'src') : undefined
    if (icon) p.icon = icon

    let list = programmes.get(channel)
    if (!list) programmes.set(channel, (list = []))
    list.push(p)
  }
  for (const list of programmes.values()) list.sort((x, y) => x.start - y.start)

  return { channels, programmes }
}
