import { useEffect } from 'react'
import type { Channel } from '../../shared/channels'
import { upcoming } from '../../shared/epg'
import { formatRange, useEpg } from '../lib/epg'

/** "On now" and "Up next" for the channel in the player. */
export function NowNext({ channel, onOpenGuide }: { channel: Channel; onOpenGuide: () => void }) {
  const { get, request, now, coverage, coverageLoaded } = useEpg()
  const hasGuide = coverage.has(channel.id)

  useEffect(() => {
    if (hasGuide) request([channel.id])
  }, [channel.id, hasGuide, request])

  if (!coverageLoaded) return null
  if (!hasGuide) return <p className="muted small epg-none">No TV listings for this channel.</p>

  const list = get(channel.id)
  if (list === undefined) return <p className="muted small epg-none">Loading listings…</p>
  const [current, ...next] = upcoming(list, now, 4)
  if (!current) return <p className="muted small epg-none">No listings for the next few hours.</p>

  const live = current.start <= now
  const progress = live ? Math.min(1, (now - current.start) / (current.stop - current.start)) : 0

  return (
    <div className="now-next">
      <div className="nn-current">
        <div className="nn-label">{live ? 'On now' : 'Next'}</div>
        <div className="nn-title">
          {current.title}
          {current.episode && <span className="tag subtle">{current.episode}</span>}
        </div>
        {current.subtitle && <div className="nn-sub">{current.subtitle}</div>}
        <div className="nn-time muted small">
          {formatRange(current)}
          {live && ` · ${Math.max(1, Math.round((current.stop - now) / 60_000))} min left`}
        </div>
        {live && (
          <div className="progress" aria-hidden>
            <div style={{ width: `${progress * 100}%` }} />
          </div>
        )}
        {current.description && <p className="nn-desc">{current.description}</p>}
      </div>
      {next.length > 0 && (
        <div className="nn-upcoming">
          <div className="nn-label">Later</div>
          <ul>
            {next.map(p => (
              <li key={p.start}>
                <span className="muted small nn-at">{formatRange(p)}</span>
                <span className="nn-up-title">{p.title}</span>
              </li>
            ))}
          </ul>
          <button className="link" onClick={onOpenGuide}>
            Open full guide
          </button>
        </div>
      )}
    </div>
  )
}
