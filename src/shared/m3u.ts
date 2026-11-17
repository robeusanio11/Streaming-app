// Parser for extended M3U playlists, as published by iptv-org
// (https://iptv-org.github.io/iptv/index.m3u) and most other IPTV sources.
//
// Typical entry:
//   #EXTINF:-1 tvg-id="France3.fr@HD" tvg-logo="https://..." group-title="General;News",France 3 (720p) [Geo-blocked]
//   #EXTVLCOPT:http-referrer=https://example.com/
//   #EXTVLCOPT:http-user-agent=Mozilla/5.0 ...
//   https://host/path/index.m3u8

export interface PlaylistEntry {
  /** Display name with quality and labels removed. */
  name: string
  /** e.g. "1080p", if given in the title. */
  quality?: string
  /** e.g. ["Geo-blocked", "Not 24/7"]. */
  labels: string[]
  tvgId?: string
  logo?: string
  /** Categories or groups. A group-title like "Kids;Music" gives two entries. */
  groups: string[]
  url: string
  referrer?: string
  userAgent?: string
}

export interface ParsedPlaylist {
  /** EPG (XMLTV) guide URLs from the #EXTM3U header's x-tvg-url / url-tvg. */
  epgUrls: string[]
  entries: PlaylistEntry[]
}

const ATTR_RE = /([A-Za-z0-9_-]+)="([^"]*)"/g

function parseAttributes(s: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const m of s.matchAll(ATTR_RE)) attrs[m[1].toLowerCase()] = m[2]
  return attrs
}

/** Splits an #EXTINF line into its attribute section and its title. */
function splitExtinf(line: string): { attrs: Record<string, string>; title: string } {
  const body = line.slice(line.indexOf(':') + 1)
  // The title begins after the first comma that is not inside a quoted attribute value.
  let inQuote = false
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '"') inQuote = !inQuote
    else if (c === ',' && !inQuote) {
      return { attrs: parseAttributes(body.slice(0, i)), title: body.slice(i + 1).trim() }
    }
  }
  return { attrs: parseAttributes(body), title: '' }
}

const TITLE_RE = /^(.*?)(?:\s*\(([^()]*)\))?(?:\s*\[([^\]]*)\])?\s*$/

/** "France 3 (720p) [Geo-blocked;Not 24/7]" becomes name, quality and labels. */
export function parseTitle(title: string): { name: string; quality?: string; labels: string[] } {
  const m = TITLE_RE.exec(title)
  if (!m) return { name: title, labels: [] }
  let name = m[1].trim()
  let quality: string | undefined = m[2]?.trim()
  // Only treat the parenthesised part as quality when it looks like one, e.g. 720p, 1080i, 4K.
  if (quality && !/^\d{3,4}[pi]$|^\d+K$/i.test(quality)) {
    name = `${name} (${quality})`
    quality = undefined
  }
  const labels = m[3] ? m[3].split(';').map(s => s.trim()).filter(Boolean) : []
  return { name: name || title, quality, labels }
}

export function parseM3U(text: string): ParsedPlaylist {
  const lines = text.split(/\r?\n/)
  const epgUrls: string[] = []
  const entries: PlaylistEntry[] = []

  let pending: Omit<PlaylistEntry, 'url'> | null = null

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    if (line.startsWith('#EXTM3U')) {
      const attrs = parseAttributes(line)
      const guides = attrs['x-tvg-url'] ?? attrs['url-tvg']
      if (guides) epgUrls.push(...guides.split(',').map(s => s.trim()).filter(Boolean))
      continue
    }

    if (line.startsWith('#EXTINF')) {
      const { attrs, title } = splitExtinf(line)
      const parsed = parseTitle(title || attrs['tvg-name'] || '')
      const group = attrs['group-title']
      pending = {
        name: parsed.name || 'Unknown',
        quality: parsed.quality,
        labels: parsed.labels,
        tvgId: attrs['tvg-id'] || undefined,
        logo: attrs['tvg-logo'] || undefined,
        groups: group ? group.split(';').map(s => s.trim()).filter(Boolean) : [],
        referrer: attrs['http-referrer'] || undefined,
        userAgent: attrs['http-user-agent'] || undefined,
      }
      continue
    }

    if (line.startsWith('#EXTVLCOPT:')) {
      if (!pending) continue
      const opt = line.slice('#EXTVLCOPT:'.length)
      const eq = opt.indexOf('=')
      if (eq < 0) continue
      const key = opt.slice(0, eq).trim().toLowerCase()
      const value = opt.slice(eq + 1).trim()
      if (key === 'http-referrer') pending.referrer = value
      else if (key === 'http-user-agent') pending.userAgent = value
      continue
    }

    if (line.startsWith('#EXTGRP:')) {
      if (pending) pending.groups.push(...line.slice(8).split(';').map(s => s.trim()).filter(Boolean))
      continue
    }

    if (line.startsWith('#')) continue

    // A URL line. Entries without a preceding #EXTINF still get added.
    const base = pending ?? { name: line, labels: [], groups: [] }
    entries.push({ ...base, url: line })
    pending = null
  }

  return { epgUrls, entries }
}
