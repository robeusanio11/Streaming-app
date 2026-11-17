import type { Channel } from '../../shared/channels'
import { channelHealth, type HealthMap } from './health'
import { inRegion } from './regions'

export type View = 'all' | 'favorites' | 'recent'

export interface Filters {
  search: string
  /** Channels matching any of these categories are shown. Empty means all. */
  categories: string[]
  region: string | null
  country: string | null
  view: View
  hideGeoBlocked: boolean
  hideNot247: boolean
  hideFailed: boolean
  withGuide: boolean
}

/** No filters at all. "Clear filters" goes back to this. */
export const emptyFilters: Filters = {
  search: '',
  categories: [],
  region: null,
  country: null,
  view: 'all',
  hideGeoBlocked: false,
  hideNot247: false,
  hideFailed: false,
  withGuide: false,
}

/** Fills in fields missing from filters saved by an older version of the app. */
export function normalizeFilters(saved: Partial<Filters> & { category?: string | null }): Filters {
  const f = { ...emptyFilters, ...saved }
  if (!Array.isArray(f.categories)) f.categories = []
  // Older versions stored a single category.
  if (saved.category && !f.categories.length) f.categories = [saved.category]
  delete (f as { category?: unknown }).category
  return f
}

/** What a first-time visitor sees: channels from their home country. */
export function initialFilters(homeCountry: string): Filters {
  return { ...emptyFilters, country: homeCountry }
}

export interface FilterContext {
  favorites: string[]
  recent: string[]
  health: HealthMap
  /** Ids of channels that have TV guide data. */
  guide: Set<string>
  /** Channels from this country are listed first. */
  homeCountry: string
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** True if every stream has the label, so no stream would play without that problem. */
function allLabelled(ch: Channel, label: string): boolean {
  return ch.streams.every(s => s.labels.includes(label))
}

/** Applies every filter except the ones named in `skip`. Sidebar counts use the skipped versions. */
export function filterChannels(
  channels: Channel[],
  f: Filters,
  ctx: FilterContext,
  skip: { category?: boolean; country?: boolean; region?: boolean } = {},
): Channel[] {
  const terms = normalize(f.search).split(/\s+/).filter(Boolean)
  const favs = new Set(ctx.favorites)

  let list = channels
  if (f.view === 'favorites') list = list.filter(c => favs.has(c.id))
  if (f.view === 'recent') {
    const byId = new Map(channels.map(c => [c.id, c]))
    list = ctx.recent.map(id => byId.get(id)).filter((c): c is Channel => !!c)
  }

  const out = list.filter(ch => {
    if (!skip.category && f.categories.length && !f.categories.some(c => ch.categories.includes(c))) return false
    if (!skip.region && f.region && !inRegion(ch.country, f.region)) return false
    if (!skip.country && f.country && ch.country !== f.country) return false
    if (f.withGuide && !ctx.guide.has(ch.id)) return false
    if (f.hideGeoBlocked && allLabelled(ch, 'Geo-blocked')) return false
    if (f.hideNot247 && allLabelled(ch, 'Not 24/7')) return false
    if (f.hideFailed && channelHealth(ch, ctx.health) === 'dead') return false
    if (terms.length) {
      const hay = normalize(`${ch.name} ${ch.id} ${ch.categories.join(' ')}`)
      if (!terms.every(t => hay.includes(t))) return false
    }
    return true
  })

  // Home-country channels go first (the list is otherwise alphabetical). Recent keeps its order.
  if (f.view !== 'recent' && !f.country && ctx.homeCountry) {
    const home = out.filter(c => c.country === ctx.homeCountry)
    if (home.length && home.length < out.length) return [...home, ...out.filter(c => c.country !== ctx.homeCountry)]
  }
  return out
}

export function countBy(channels: Channel[], key: (c: Channel) => string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const c of channels) for (const k of key(c)) counts.set(k, (counts.get(k) ?? 0) + 1)
  return counts
}
