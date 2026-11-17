import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Channel } from '../../shared/channels'
import type { Programme } from '../../shared/epg'
import { formatRange, formatTime, useEpg } from '../lib/epg'
import { ChannelLogo } from './ChannelLogo'

interface Props {
  channels: Channel[]
  selectedId: string | null
  onPlay: (ch: Channel) => void
  showAll: boolean
  onShowAll: (v: boolean) => void
}

const PX_PER_MIN = 4 // 30 minutes = 120px
const ROW_H = 64
const CHANNEL_COL_WIDE = 210
const CHANNEL_COL_NARROW = 116

function useNarrow(): boolean {
  const query = '(max-width: 760px)'
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}
const HOURS = 24
const SLOT_MIN = 30

function floorToSlot(ms: number): number {
  const d = new Date(ms)
  d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0)
  return d.getTime()
}

interface Selected {
  ch: Channel
  p: Programme
}

export function Guide({ channels, selectedId, onPlay, showAll, onShowAll }: Props) {
  const { get, request, now, version, coverageLoaded } = useEpg()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<Selected | null>(null)
  const CHANNEL_COL = useNarrow() ? CHANNEL_COL_NARROW : CHANNEL_COL_WIDE

  // The grid starts half an hour before the current half-hour and covers the next day.
  // It stays fixed until the guide is reopened, so the layout doesn't shift while you browse.
  const [start] = useState(() => floorToSlot(Date.now()) - SLOT_MIN * 60_000)
  const end = start + HOURS * 3600_000
  const width = HOURS * 60 * PX_PER_MIN
  const x = (ms: number) => ((Math.max(start, Math.min(end, ms)) - start) / 60_000) * PX_PER_MIN

  const slots = useMemo(() => {
    const out: number[] = []
    for (let t = start; t < end; t += SLOT_MIN * 60_000) out.push(t)
    return out
  }, [start, end])

  const virtualizer = useVirtualizer({
    count: channels.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 6,
  })
  const items = virtualizer.getVirtualItems()

  // Load programmes for the rows on screen.
  const visibleIds = items.map(i => channels[i.index]?.id).filter(Boolean).join('|')
  useEffect(() => {
    if (visibleIds) request(visibleIds.split('|'))
  }, [visibleIds, request])

  const scrollToNow = (smooth = true) => {
    scrollRef.current?.scrollTo({ left: Math.max(0, x(Date.now()) - 60 * PX_PER_MIN), behavior: smooth ? 'smooth' : 'auto' })
  }
  useLayoutEffect(() => scrollToNow(false), []) // eslint-disable-line react-hooks/exhaustive-deps

  const nowX = x(now)
  const selectedLive = selected && selected.p.start <= now && selected.p.stop > now

  return (
    <section className="guide">
      <div className="guide-toolbar">
        <span className="muted small">
          {channels.length.toLocaleString()} channel{channels.length === 1 ? '' : 's'}
          {!coverageLoaded && ' · checking which channels have listings…'}
        </span>
        <label className="check inline">
          <input type="checkbox" checked={showAll} onChange={e => onShowAll(e.target.checked)} />
          Include channels without listings
        </label>
        <button className="btn" onClick={() => scrollToNow()}>
          Now
        </button>
      </div>

      {channels.length === 0 ? (
        <div className="list empty">
          {coverageLoaded ? (
            <p>No channels with TV listings match these filters. Try another country or region.</p>
          ) : (
            <>
              <div className="spinner" aria-hidden />
              <p>Loading TV listings…</p>
            </>
          )}
        </div>
      ) : (
        <div ref={scrollRef} className="guide-scroll">
          <div className="guide-inner" style={{ width: CHANNEL_COL + width }}>
            <div className="guide-head" style={{ width: CHANNEL_COL + width }}>
              <div className="guide-corner" style={{ width: CHANNEL_COL }}>
                {new Date(start).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
              </div>
              <div className="guide-times" style={{ width }}>
                {slots.map(t => (
                  <div key={t} className="guide-slot" style={{ left: x(t), width: SLOT_MIN * PX_PER_MIN }}>
                    {formatTime(t)}
                  </div>
                ))}
              </div>
            </div>

            <div className="guide-body" style={{ height: virtualizer.getTotalSize(), width: CHANNEL_COL + width }}>
              {nowX > 0 && nowX < width && (
                <div className="guide-now" style={{ left: CHANNEL_COL + nowX }} aria-hidden />
              )}
              {items.map(item => {
                const ch = channels[item.index]
                const list = get(ch.id)
                return (
                  <div
                    key={ch.id}
                    className={`guide-row ${ch.id === selectedId ? 'selected' : ''}`}
                    style={{ transform: `translateY(${item.start}px)`, height: ROW_H, width: CHANNEL_COL + width }}
                    data-version={version}
                  >
                    <button
                      className="guide-channel"
                      style={{ width: CHANNEL_COL }}
                      onClick={() => onPlay(ch)}
                      title={`Watch ${ch.name}`}
                    >
                      <ChannelLogo src={ch.logo} name={ch.name} />
                      <span className="guide-channel-name">{ch.name}</span>
                    </button>
                    <div className="guide-track" style={{ width }}>
                      {list === undefined && <div className="guide-loading" />}
                      {list?.length === 0 && <div className="guide-none">No listings</div>}
                      {list
                        ?.filter(p => p.stop > start && p.start < end)
                        .map(p => {
                          const left = x(p.start)
                          const w = Math.max(2, x(p.stop) - left)
                          const live = p.start <= now && p.stop > now
                          const past = p.stop <= now
                          const isSel = selected?.ch.id === ch.id && selected.p.start === p.start
                          return (
                            <button
                              key={p.start}
                              className={`guide-prog ${live ? 'live' : ''} ${past ? 'past' : ''} ${isSel ? 'sel' : ''}`}
                              style={{ left, width: w }}
                              onClick={() => setSelected({ ch, p })}
                              onDoubleClick={() => live && onPlay(ch)}
                              title={`${p.title}\n${formatRange(p)}`}
                            >
                              <span className="gp-title">{p.title}</span>
                              <span className="gp-time">{formatRange(p)}</span>
                            </button>
                          )
                        })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="guide-detail" role="dialog" aria-label="Programme details">
          {selected.p.icon && <img className="gd-img" src={selected.p.icon} alt="" referrerPolicy="no-referrer" />}
          <div className="gd-main">
            <div className="gd-title">
              {selected.p.title}
              {selected.p.episode && <span className="tag subtle">{selected.p.episode}</span>}
              {selectedLive && <span className="tag live">On now</span>}
            </div>
            <div className="muted small">
              {selected.ch.name} · {new Date(selected.p.start).toLocaleDateString([], { weekday: 'short' })} {formatRange(selected.p)}
              {selected.p.categories?.length ? ` · ${selected.p.categories.slice(0, 3).join(', ')}` : ''}
            </div>
            {selected.p.subtitle && <div className="gd-sub">{selected.p.subtitle}</div>}
            {selected.p.description && <p className="gd-desc">{selected.p.description}</p>}
          </div>
          <div className="gd-actions">
            <button className="btn primary" onClick={() => onPlay(selected.ch)}>
              {selectedLive ? 'Watch now' : 'Watch channel'}
            </button>
            <button className="btn ghost" onClick={() => setSelected(null)} aria-label="Close details">
              Close
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
