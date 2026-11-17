import { useEffect, useRef, useState } from 'react'
import type { PlaybackMode } from './Player'

interface Props {
  open: boolean
  onClose: () => void
  playlistUrl: string
  defaultPlaylistUrl: string
  onPlaylistUrl: (url: string) => void
  mode: PlaybackMode
  onMode: (m: PlaybackMode) => void
  fetchedAt?: string
  onRefresh: () => void
  refreshing: boolean
}

export function Settings(p: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(p.playlistUrl)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (p.open && !d.open) {
      setDraft(p.playlistUrl)
      d.showModal()
    } else if (!p.open && d.open) d.close()
  }, [p.open, p.playlistUrl])

  return (
    <dialog ref={ref} className="settings" onClose={p.onClose}>
      <form
        method="dialog"
        onSubmit={() => {
          p.onPlaylistUrl(draft.trim())
        }}
      >
        <h2>Settings</h2>

        <label className="field">
          <span>Playlist URL</span>
          <input
            className="input"
            type="url"
            value={draft}
            placeholder={p.defaultPlaylistUrl}
            onChange={e => setDraft(e.target.value)}
          />
          <small className="muted">
            Any M3U playlist works. Leave it empty for the default iptv-org list, or use a filtered one such as{' '}
            <code>https://iptv-org.github.io/iptv/countries/us.m3u</code>.
          </small>
        </label>

        <fieldset className="field">
          <legend>Playback</legend>
          {(
            [
              ['auto', 'Automatic', 'Play directly when the browser can, and use the relay when it can’t.'],
              ['relay', 'Always use the relay', 'Most streams work this way. All video passes through this app’s server.'],
              ['direct', 'Never use the relay', 'Saves server bandwidth, but many streams won’t play.'],
            ] as const
          ).map(([value, title, desc]) => (
            <label key={value} className="radio">
              <input type="radio" name="mode" checked={p.mode === value} onChange={() => p.onMode(value)} />
              <span>
                <strong>{title}</strong>
                <small className="muted">{desc}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="field row-between">
          <span className="muted small">
            {p.fetchedAt ? `Playlist downloaded ${new Date(p.fetchedAt).toLocaleString()}` : 'Playlist not loaded'}
          </span>
          <button type="button" className="btn" onClick={p.onRefresh} disabled={p.refreshing}>
            {p.refreshing ? 'Refreshing…' : 'Refresh now'}
          </button>
        </div>

        <div className="actions">
          <button type="button" className="btn ghost" onClick={p.onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Save
          </button>
        </div>
      </form>
    </dialog>
  )
}
