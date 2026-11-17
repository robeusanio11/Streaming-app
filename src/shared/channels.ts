import type { PlaylistEntry } from './m3u.js'

export interface StreamSource {
  url: string
  quality?: string
  labels: string[]
  referrer?: string
  userAgent?: string
}

export interface Channel {
  /** Stable key: tvg-id when present, otherwise the normalised name. */
  id: string
  name: string
  logo?: string
  /** Lower-case ISO-3166 style code taken from the tvg-id (e.g. "us", "uk"), if any. */
  country?: string
  categories: string[]
  /** Every known URL for this channel, best first. */
  streams: StreamSource[]
}

export interface ChannelData {
  sourceUrl: string
  fetchedAt: string
  epgUrls: string[]
  channels: Channel[]
}

export const UNCATEGORIZED = 'Undefined'

/** "France3.fr@HD" gives "fr". */
export function countryFromTvgId(tvgId?: string): string | undefined {
  if (!tvgId) return undefined
  const m = /\.([a-z]{2})(?:@|$)/i.exec(tvgId)
  return m ? m[1].toLowerCase() : undefined
}

function qualityRank(q?: string): number {
  if (!q) return 0
  const k = /^(\d+)K$/i.exec(q)
  if (k) return Number(k[1]) * 1000
  const n = parseInt(q, 10)
  return Number.isFinite(n) ? n : 0
}

/** Healthy streams come first, then higher quality, then HTTPS. */
function streamScore(s: StreamSource): number {
  let score = 0
  if (s.labels.length === 0) score += 100_000
  score += qualityRank(s.quality)
  if (s.url.startsWith('https:')) score += 1
  return score
}

/** Merges playlist entries that point at the same channel into one channel with several streams. */
export function groupEntries(entries: PlaylistEntry[]): Channel[] {
  const map = new Map<string, Channel>()

  for (const e of entries) {
    const id = e.tvgId || `name:${e.name.toLowerCase()}`
    let ch = map.get(id)
    if (!ch) {
      ch = {
        id,
        name: e.name,
        logo: e.logo,
        country: countryFromTvgId(e.tvgId),
        categories: [],
        streams: [],
      }
      map.set(id, ch)
    }
    if (!ch.logo && e.logo) ch.logo = e.logo
    for (const g of e.groups.length ? e.groups : [UNCATEGORIZED]) {
      if (!ch.categories.includes(g)) ch.categories.push(g)
    }
    if (!ch.streams.some(s => s.url === e.url)) {
      ch.streams.push({
        url: e.url,
        quality: e.quality,
        labels: e.labels,
        referrer: e.referrer,
        userAgent: e.userAgent,
      })
    }
  }

  const channels = [...map.values()]
  for (const ch of channels) {
    // A channel with real categories should not also appear under Undefined.
    if (ch.categories.length > 1) ch.categories = ch.categories.filter(c => c !== UNCATEGORIZED)
    ch.categories.sort()
    ch.streams.sort((a, b) => streamScore(b) - streamScore(a))
  }
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
  channels.sort((a, b) => collator.compare(a.name, b.name))
  return channels
}
