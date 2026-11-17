import { useEffect, useRef, useState } from 'react'
import { countryFlag, countryName } from '../lib/countries'
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
  homeCountry: string
  onHomeCountry: (code: string) => void
  /** Country codes present in the playlist. */
  countries: string[]
  epgSources: string[]
  onEpgSources: (urls: string[]) => void
}

export function Settings(p: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(p.playlistUrl)
  const [epgDraft, setEpgDraft] = useState(p.epgSources.join('\n'))

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (p.open && !d.open) {
      setDraft(p.playlistUrl)
      setEpgDraft(p.epgSources.join('\n'))
      d.showModal()
    } else if (!p.open && d.open) d.close()
  }, [p.open, p.playlistUrl, p.epgSources])

  const sortedCountries = [...new Set([p.homeCountry, ...p.countries])]
    .filter(Boolean)
    .map(code => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <dialog ref={ref} className="settings" onClose={p.onClose}>
      <form
        method="dialog"
        onSubmit={() => {
          p.onEpgSources(
            epgDraft
              .split(/[\s,]+/)
              .map(u => u.trim())
              .filter(u => /^https?:\/\//i.test(u)),
          )
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

        <label className="field">
          <span>Home country</span>
          <select className="input" value={p.homeCountry} onChange={e => p.onHomeCountry(e.target.value)}>
            {sortedCountries.map(c => (
              <option key={c.code} value={c.code}>
                {countryFlag(c.code)} {c.name}
              </option>
            ))}
          </select>
          <small className="muted">Its channels are listed first, and its regions appear at the top of the region list.</small>
        </label>

        <label className="field">
          <span>Extra TV guide sources</span>
          <textarea
            className="input textarea"
            rows={3}
            value={epgDraft}
            placeholder="https://example.com/guide.xml.gz"
            onChange={e => setEpgDraft(e.target.value)}
          />
          <small className="muted">
            Optional XMLTV links, one per line. They're matched to channels by ID, then by name. Pluto TV, Plex, Roku,
            Samsung TV Plus and PBS listings are already built in.
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
