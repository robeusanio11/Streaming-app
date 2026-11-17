import { useVirtualizer } from '@tanstack/react-virtual'
import { memo, useEffect, useRef } from 'react'
import { UNCATEGORIZED, type Channel } from '../../shared/channels'
import { countryFlag, countryName } from '../lib/countries'
import { channelHealth, type HealthMap } from '../lib/health'
import { ChannelLogo } from './ChannelLogo'

interface Props {
  channels: Channel[]
  selectedId: string | null
  favorites: Set<string>
  health: HealthMap
  onSelect: (ch: Channel) => void
  onToggleFavorite: (id: string) => void
}

const ROW_HEIGHT = 60

const Row = memo(function Row({
  ch,
  selected,
  favorite,
  health,
  onSelect,
  onToggleFavorite,
}: {
  ch: Channel
  selected: boolean
  favorite: boolean
  health: 'ok' | 'dead' | 'unknown'
  onSelect: (ch: Channel) => void
  onToggleFavorite: (id: string) => void
}) {
  const qualities = ch.streams.map(s => s.quality).filter(Boolean)
  const best = qualities[0]
  const allGeo = ch.streams.every(s => s.labels.includes('Geo-blocked'))
  return (
    <div
      className={`row ${selected ? 'selected' : ''} ${health === 'dead' ? 'dead' : ''}`}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onClick={() => onSelect(ch)}
    >
      <ChannelLogo src={ch.logo} name={ch.name} />
      <div className="row-main">
        <div className="row-name" title={ch.name}>
          {health !== 'unknown' && <span className={`dot ${health}`} title={health === 'ok' ? 'Played recently' : 'Failed recently'} />}
          {ch.name}
        </div>
        <div className="row-sub">
          {ch.country && (
            <span title={countryName(ch.country)}>
              {countryFlag(ch.country)} {ch.country.toUpperCase()}
            </span>
          )}
          <span className="row-cats">{ch.categories.filter(c => c !== UNCATEGORIZED).join(', ')}</span>
        </div>
      </div>
      <div className="row-side">
        {best && <span className="tag">{best}</span>}
        {allGeo && <span className="tag warn" title="Geo-blocked">Geo</span>}
        {ch.streams.length > 1 && <span className="tag subtle" title={`${ch.streams.length} streams`}>×{ch.streams.length}</span>}
        <button
          className={`fav ${favorite ? 'on' : ''}`}
          aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
          title={favorite ? 'Remove from favorites' : 'Add to favorites'}
          onClick={e => {
            e.stopPropagation()
            onToggleFavorite(ch.id)
          }}
        >
          {favorite ? '★' : '☆'}
        </button>
      </div>
    </div>
  )
})

export function ChannelList({ channels, selectedId, favorites, health, onSelect, onToggleFavorite }: Props) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: channels.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  // Keep the playing channel in view when it is changed with previous/next.
  useEffect(() => {
    if (!selectedId) return
    const idx = channels.findIndex(c => c.id === selectedId)
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'auto' })
  }, [selectedId, channels, virtualizer])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const idx = channels.findIndex(c => c.id === selectedId)
    const next = e.key === 'ArrowDown' ? Math.min(channels.length - 1, idx + 1) : Math.max(0, idx - 1)
    if (channels[next]) onSelect(channels[next])
  }

  if (!channels.length) {
    return <div className="list empty">No channels match these filters.</div>
  }

  return (
    <div ref={parentRef} className="list" role="listbox" tabIndex={0} onKeyDown={onKeyDown} aria-label="Channels">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(item => {
          const ch = channels[item.index]
          return (
            <div
              key={ch.id}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
            >
              <Row
                ch={ch}
                selected={ch.id === selectedId}
                favorite={favorites.has(ch.id)}
                health={channelHealth(ch, health)}
                onSelect={onSelect}
                onToggleFavorite={onToggleFavorite}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
