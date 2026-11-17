import type { Channel } from '../../shared/channels'
import { channelHealth, type HealthMap } from './health'

export type View = 'all' | 'favorites' | 'recent'

export interface Filters {
  search: string
  category: string | null
  country: string | null
  view: View
  hideGeoBlocked: boolean
  hideNot247: boolean
  hideFailed: boolean
}

export const defaultFilters: Filters = {
  search: '',
  category: null,
  country: null,
  view: 'all',
  hideGeoBlocked: false,
  hideNot247: false,
  hideFailed: false,
}

interface Context {
  favorites: string[]
  recent: string[]
  health: HealthMap
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
  ctx: Context,
  skip: { category?: boolean; country?: boolean } = {},
): Channel[] {
  const terms = normalize(f.search).split(/\s+/).filter(Boolean)
  const favs = new Set(ctx.favorites)

  let list = channels
  if (f.view === 'favorites') list = list.filter(c => favs.has(c.id))
  if (f.view === 'recent') {
    const byId = new Map(channels.map(c => [c.id, c]))
    list = ctx.recent.map(id => byId.get(id)).filter((c): c is Channel => !!c)
  }

  return list.filter(ch => {
    if (!skip.category && f.category && !ch.categories.includes(f.category)) return false
    if (!skip.country && f.country && ch.country !== f.country) return false
    if (f.hideGeoBlocked && allLabelled(ch, 'Geo-blocked')) return false
    if (f.hideNot247 && allLabelled(ch, 'Not 24/7')) return false
    if (f.hideFailed && channelHealth(ch, ctx.health) === 'dead') return false
    if (terms.length) {
      const hay = normalize(`${ch.name} ${ch.id} ${ch.categories.join(' ')}`)
      if (!terms.every(t => hay.includes(t))) return false
    }
    return true
  })
}

export function countBy(channels: Channel[], key: (c: Channel) => string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const c of channels) for (const k of key(c)) counts.set(k, (counts.get(k) ?? 0) + 1)
  return counts
}
