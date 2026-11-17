import { useMemo, useState } from 'react'
import { UNCATEGORIZED } from '../../shared/channels'
import { countryFlag, countryName } from '../lib/countries'
import type { Filters, View } from '../lib/filter'

interface Props {
  filters: Filters
  setFilters: (f: (prev: Filters) => Filters) => void
  categoryCounts: Map<string, number>
  countryCounts: Map<string, number>
  viewCounts: Record<View, number>
}

function label(cat: string) {
  return cat === UNCATEGORIZED ? 'Uncategorized' : cat
}

export function Sidebar({ filters, setFilters, categoryCounts, countryCounts, viewCounts }: Props) {
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
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [countryCounts, countryQuery])

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
      </details>

      <details className="side-section" open>
        <summary>Category</summary>
        <button className={`side-item ${filters.category === null ? 'active' : ''}`} onClick={() => set('category', null)}>
          <span>Any category</span>
        </button>
        {categories.map(([cat, n]) => (
          <button
            key={cat}
            className={`side-item ${filters.category === cat ? 'active' : ''}`}
            onClick={() => set('category', filters.category === cat ? null : cat)}
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
          <span>Any country</span>
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
