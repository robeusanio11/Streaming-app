import data from './regions.json'
import { isoCode } from './countries'

export interface Region {
  code: string
  name: string
  /** Lower-case ISO 3166-1 codes. */
  countries: string[]
}

/** iptv-org's region definitions, without the "Worldwide" and "United Nations" groupings. */
export const regions: Region[] = data

const byCode = new Map(regions.map(r => [r.code, r]))
const memberCache = new Map<string, Set<string>>()

function members(code: string): Set<string> {
  let s = memberCache.get(code)
  if (!s) memberCache.set(code, (s = new Set(byCode.get(code)?.countries ?? [])))
  return s
}

export function regionName(code: string): string {
  return byCode.get(code)?.name ?? code
}

/** Whether a channel country (as found in tvg-ids, e.g. "uk") is part of a region. */
export function inRegion(country: string | undefined, regionCode: string): boolean {
  return !!country && members(regionCode).has(isoCode(country).toLowerCase())
}

/** Regions that include the given country, smallest first (e.g. Northern America before Americas). */
export function regionsContaining(country: string): Region[] {
  const iso = isoCode(country).toLowerCase()
  return regions.filter(r => r.countries.includes(iso)).sort((a, b) => a.countries.length - b.countries.length)
}
