import { useEffect, useMemo, useRef } from 'react'
import { UNCATEGORIZED } from '../../shared/channels'
import { toggle } from './Sidebar'

/** The categories most people look for come first. The rest follow by channel count. */
const FEATURED = ['News', 'Sports', 'Movies', 'Series', 'Entertainment', 'Kids', 'Music', 'Documentary', 'Comedy']

interface Props {
  selected: string[]
  counts: Map<string, number>
  onChange: (categories: string[]) => void
}

/** A scrollable row of category chips. Several can be selected; channels in any of them are shown. */
export function CategoryChips({ selected, counts, onChange }: Props) {
  const chips = useMemo(() => {
    const all = [...counts.keys()].filter(c => c !== UNCATEGORIZED)
    for (const c of selected) if (!all.includes(c)) all.push(c)
    const rank = (c: string) => {
      const i = FEATURED.indexOf(c)
      return i < 0 ? FEATURED.length : i
    }
    return all.sort((a, b) => rank(a) - rank(b) || (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
  }, [counts, selected])

  // When the row first appears (e.g. after a reload), scroll so the first selected chip is visible.
  const rowRef = useRef<HTMLDivElement>(null)
  const hasChips = chips.length > 0
  useEffect(() => {
    const row = rowRef.current
    const on = row?.querySelector<HTMLElement>('.chip.on')
    if (!row || !on) return
    const left = on.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft
    if (left + on.offsetWidth > row.clientWidth) row.scrollLeft = left - 12
  }, [hasChips])

  if (!hasChips) return null

  return (
    <div ref={rowRef} className="chips" role="group" aria-label="Categories">
      <button className={`chip ${selected.length === 0 ? 'on' : ''}`} aria-pressed={selected.length === 0} onClick={() => onChange([])}>
        All
      </button>
      {chips.map(c => {
        const on = selected.includes(c)
        const n = counts.get(c) ?? 0
        return (
          <button
            key={c}
            className={`chip ${on ? 'on' : ''}`}
            aria-pressed={on}
            disabled={!on && n === 0}
            onClick={() => onChange(toggle(selected, c))}
          >
            {c}
            <span className="chip-count">{n.toLocaleString()}</span>
          </button>
        )
      })}
    </div>
  )
}
