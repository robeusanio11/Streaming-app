import { useMemo, useState } from 'react'
import { UNCATEGORIZED } from '../../shared/channels'
import { countryFlag, countryName } from '../lib/countries'
import type { Filters, View } from '../lib/filter'
import { regions, regionsContaining } from '../lib/regions'

interface Props {
  filters: Filters
  setFilters: (f: (prev: Filters) => Filters) => void
  categoryCounts: Map<string, number>
  countryCounts: Map<string, number>
  /** Channel counts per country with the region and country filters left out, for region totals. */
  allCountryCounts: Map<string, number>
  viewCounts: Record<View, number>
  homeCountry: string
  guideCount: number | null
}

export function toggle(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter(x => x !== item) : [...list, item]
}

function label(cat: string) {
  return cat === UNCATEGORIZED ? 'Uncategorized' : cat
}

export function Sidebar({
  filters,
  setFilters,
  categoryCounts,
  countryCounts,
  allCountryCounts,
  viewCounts,
  homeCountry,
  guideCount,
}: Props) {
  const [countryQuery, setCountryQuery] = useState('')

  const categories = useMemo(
    () =>
      [...categoryCounts.entries()].sort((a, b) => {
        // Uncategorized goes last, the rest alphabetically.
        if (a[0] === UNCATEGORIZED) return 1
        if (b[0] === UNCATEGORIZED) return -1
        return a[0].localeCompare(b[0])
      }),
    [categoryCounts],
  )

  const countries = useMemo(() => {
    const q = countryQuery.trim().toLowerCase()
    return [...countryCounts.entries()]
      .map(([code, n]) => ({ code, n, name: countryName(code) }))
      .filter(c => !q || c.name.toLowerCase().includes(q) || c.code.includes(q))
      .sort((a, b) => (a.code === homeCountry ? -1 : b.code === homeCountry ? 1 : a.name.localeCompare(b.name)))
  }, [countryCounts, countryQuery, homeCountry])

  const regionCount = (countries: string[]) => {
    let n = 0
    for (const [code, count] of allCountryCounts) {
      const iso = code === 'uk' ? 'gb' : code
      if (countries.includes(iso)) n += count
    }
    return n
  }
  const nearby = homeCountry ? regionsContaining(homeCountry) : []
  const others = regions.filter(r => !nearby.includes(r))

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters(f => ({ ...f, [key]: value }))

  return (
    <aside className="sidebar">
      <nav className="views" aria-label="Views">
        {(
          [
            ['all', 'All channels'],
            ['favorites', 'Favorites'],
            ['recent', 'Recently watched'],
          ] as const
        ).map(([v, text]) => (
          <button key={v} className={`side-item ${filters.view === v ? 'active' : ''}`} onClick={() => set('view', v)}>
            <span>{text}</span>
            <span className="count">{viewCounts[v].toLocaleString()}</span>
          </button>
        ))}
      </nav>

      <details className="side-section" open>
        <summary>Status</summary>
        <label className="check">
          <input type="checkbox" checked={filters.hideGeoBlocked} onChange={e => set('hideGeoBlocked', e.target.checked)} />
          Hide geo-blocked
        </label>
        <label className="check">
          <input type="checkbox" checked={filters.hideNot247} onChange={e => set('hideNot247', e.target.checked)} />
          Hide part-time (not 24/7)
        </label>
        <label className="check">
          <input type="checkbox" checked={filters.hideFailed} onChange={e => set('hideFailed', e.target.checked)} />
          Hide channels that failed for me
        </label>
        <label className="check">
          <input type="checkbox" checked={filters.withGuide} onChange={e => set('withGuide', e.target.checked)} />
          Only channels with TV listings
          {guideCount !== null && <span className="count">{guideCount.toLocaleString()}</span>}
        </label>
      </details>

      <details className="side-section" open>
        <summary>Region</summary>
        {homeCountry && (
          <button
            className={`side-item ${filters.country === homeCountry && !filters.region ? 'active' : ''}`}
            onClick={() => setFilters(f => ({ ...f, region: null, country: homeCountry }))}
          >
            <span>
              {countryFlag(homeCountry)} {countryName(homeCountry)} only
            </span>
            <span className="count">{(allCountryCounts.get(homeCountry) ?? 0).toLocaleString()}</span>
          </button>
        )}
        <select
          className="input small region-select"
          aria-label="Region"
          value={filters.region ?? ''}
          onChange={e => setFilters(f => ({ ...f, region: e.target.value || null, country: null }))}
        >
          <option value="">Anywhere</option>
          {nearby.length > 0 && (
            <optgroup label={`Including ${countryName(homeCountry)}`}>
              {nearby.map(r => (
                <option key={r.code} value={r.code}>
                  {r.name} ({regionCount(r.countries).toLocaleString()})
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Other regions">
            {others.map(r => (
              <option key={r.code} value={r.code}>
                {r.name} ({regionCount(r.countries).toLocaleString()})
              </option>
            ))}
          </optgroup>
        </select>
      </details>

      <details className="side-section" open>
        <summary>Category</summary>
        <button className={`side-item ${filters.categories.length === 0 ? 'active' : ''}`} onClick={() => set('categories', [])}>
          <span>Any category</span>
        </button>
        {categories.map(([cat, n]) => (
          <button
            key={cat}
            className={`side-item ${filters.categories.includes(cat) ? 'active' : ''}`}
            aria-pressed={filters.categories.includes(cat)}
            onClick={() => set('categories', toggle(filters.categories, cat))}
          >
            <span>{label(cat)}</span>
            <span className="count">{n.toLocaleString()}</span>
          </button>
        ))}
      </details>

      <details className="side-section" open>
        <summary>Country</summary>
        <input
          className="input small"
          type="search"
          placeholder="Find a country"
          value={countryQuery}
          onChange={e => setCountryQuery(e.target.value)}
        />
        <button className={`side-item ${filters.country === null ? 'active' : ''}`} onClick={() => set('country', null)}>
          <span>{filters.region ? 'Any country in region' : 'Any country'}</span>
        </button>
        <div className="country-list">
          {countries.map(c => (
            <button
              key={c.code}
              className={`side-item ${filters.country === c.code ? 'active' : ''}`}
              onClick={() => set('country', filters.country === c.code ? null : c.code)}
            >
              <span>
                {countryFlag(c.code)} {c.name}
              </span>
              <span className="count">{c.n.toLocaleString()}</span>
            </button>
          ))}
        </div>
      </details>
    </aside>
  )
}
