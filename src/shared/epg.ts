/** One TV programme. Times are epoch milliseconds. */
export interface Programme {
  start: number
  stop: number
  title: string
  subtitle?: string
  description?: string
  categories?: string[]
  /** e.g. "S03E34" */
  episode?: string
  icon?: string
}

/** POST /api/epg request body. */
export interface EpgRequest {
  /** The playlist the channels come from. Defaults to the server's playlist. */
  playlistUrl?: string
  /** Channel ids (tvg-ids) as returned in the playlist. */
  ids: string[]
  from: number
  to: number
}

export interface EpgResponse {
  /** Programmes per channel id. Channels with no guide data are left out. */
  programmes: Record<string, Programme[]>
}

/** The programme on air at `at`, if any. */
export function programmeAt(list: Programme[] | undefined, at: number): Programme | undefined {
  if (!list) return undefined
  // Lists are short (a day of programmes), so a linear scan is fine.
  return list.find(p => p.start <= at && p.stop > at)
}

export function upcoming(list: Programme[] | undefined, at: number, count: number): Programme[] {
  if (!list) return []
  return list.filter(p => p.stop > at).slice(0, count)
}
