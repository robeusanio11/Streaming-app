import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Channel, ChannelData } from '../shared/channels'
import { ChannelList } from './components/ChannelList'
import { Player, type PlaybackMode } from './components/Player'
import { Settings } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import { fetchDefaultPlaylistUrl, fetchPlaylist } from './lib/api'
import { countBy, defaultFilters, filterChannels, type Filters } from './lib/filter'
import { useStreamHealth } from './lib/health'
import { useStoredState } from './lib/storage'

const MAX_RECENT = 50

export function App() {
  const [playlistUrl, setPlaylistUrl] = useStoredState('playlistUrl', '')
  const [defaultUrl, setDefaultUrl] = useState('')
  const [data, setData] = useState<ChannelData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const [filters, setFilters] = useStoredState<Filters>('filters', defaultFilters)
  const [favorites, setFavorites] = useStoredState<string[]>('favorites', [])
  const [recent, setRecent] = useStoredState<string[]>('recent', [])
  const [mode, setMode] = useStoredState<PlaybackMode>('playbackMode', 'auto')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { health, record } = useStreamHealth()

  useEffect(() => {
    fetchDefaultPlaylistUrl().then(setDefaultUrl).catch(() => {})
  }, [])

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true)
      else setLoading(true)
      setError('')
      try {
        setData(await fetchPlaylist(playlistUrl || undefined, refresh))
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [playlistUrl],
  )

  useEffect(() => {
    load()
  }, [load])

  const channels = data?.channels ?? []
  const deferredSearch = useDeferredValue(filters.search)
  const effective = useMemo(() => ({ ...filters, search: deferredSearch }), [filters, deferredSearch])
  const ctx = useMemo(() => ({ favorites, recent, health }), [favorites, recent, health])

  const visible = useMemo(() => filterChannels(channels, effective, ctx), [channels, effective, ctx])
  const categoryCounts = useMemo(
    () => countBy(filterChannels(channels, effective, ctx, { category: true }), c => c.categories),
    [channels, effective, ctx],
  )
  const countryCounts = useMemo(
    () => countBy(filterChannels(channels, effective, ctx, { country: true }), c => (c.country ? [c.country] : [])),
    [channels, effective, ctx],
  )
  const viewCounts = useMemo(() => {
    const ids = new Set(channels.map(c => c.id))
    return {
      all: channels.length,
      favorites: favorites.filter(id => ids.has(id)).length,
      recent: recent.filter(id => ids.has(id)).length,
    }
  }, [channels, favorites, recent])

  const byId = useMemo(() => new Map(channels.map(c => [c.id, c])), [channels])
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null
  const favSet = useMemo(() => new Set(favorites), [favorites])

  const select = useCallback(
    (ch: Channel) => {
      setSelectedId(ch.id)
      setRecent(prev => [ch.id, ...prev.filter(id => id !== ch.id)].slice(0, MAX_RECENT))
    },
    [setRecent],
  )

  const toggleFavorite = useCallback(
    (id: string) => setFavorites(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])),
    [setFavorites],
  )

  const step = (delta: number) => {
    if (!visible.length) return
    const idx = visible.findIndex(c => c.id === selectedId)
    const next = visible[(idx + delta + visible.length) % visible.length]
    if (next) select(next)
  }

  const activeFilterCount =
    (filters.category ? 1 : 0) +
    (filters.country ? 1 : 0) +
    (filters.hideGeoBlocked ? 1 : 0) +
    (filters.hideNot247 ? 1 : 0) +
    (filters.hideFailed ? 1 : 0)

  return (
    <div className={`app ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <header className="topbar">
        <button className="icon-btn only-mobile" onClick={() => setSidebarOpen(o => !o)} aria-label="Toggle filters">
          ☰
        </button>
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ▶
          </span>
          Streaming App
        </div>
        <input
          className="input search"
          type="search"
          placeholder={`Search ${channels.length.toLocaleString()} channels`}
          value={filters.search}
          onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
        />
        <button className="btn ghost" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
      </header>

      <Sidebar
        filters={filters}
        setFilters={setFilters}
        categoryCounts={categoryCounts}
        countryCounts={countryCounts}
        viewCounts={viewCounts}
      />
      <div className="scrim only-mobile" onClick={() => setSidebarOpen(false)} />

      <main className="content">
        <Player
          key={`${selected?.id ?? 'none'}|${mode}`}
          channel={selected}
          mode={mode}
          onResult={record}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
        />

        <section className="list-panel">
          <div className="list-header">
            <span>
              {loading
                ? 'Loading playlist…'
                : `${visible.length.toLocaleString()} channel${visible.length === 1 ? '' : 's'}`}
              {activeFilterCount > 0 && ` · ${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''}`}
            </span>
            <span className="list-actions">
              {(activeFilterCount > 0 || filters.search || filters.view !== 'all') && (
                <button className="link" onClick={() => setFilters(() => defaultFilters)}>
                  Clear filters
                </button>
              )}
              <button
                className="link"
                disabled={!visible.length}
                title="Play a random channel from this list"
                onClick={() => visible.length && select(visible[Math.floor(Math.random() * visible.length)])}
              >
                Random
              </button>
            </span>
          </div>
          {error ? (
            <div className="list empty error">
              <p>{error}</p>
              <button className="btn" onClick={() => load()}>
                Try again
              </button>
            </div>
          ) : loading ? (
            <div className="list empty">
              <div className="spinner" aria-hidden />
              <p>Downloading and sorting channels. The first load can take a few seconds.</p>
            </div>
          ) : (
            <ChannelList
              channels={visible}
              selectedId={selectedId}
              favorites={favSet}
              health={health}
              onSelect={ch => {
                select(ch)
                setSidebarOpen(false)
              }}
              onToggleFavorite={toggleFavorite}
            />
          )}
        </section>
      </main>

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        playlistUrl={playlistUrl}
        defaultPlaylistUrl={defaultUrl}
        onPlaylistUrl={url => {
          setPlaylistUrl(url)
          setSettingsOpen(false)
        }}
        mode={mode}
        onMode={setMode}
        fetchedAt={data?.fetchedAt}
        onRefresh={() => load(true)}
        refreshing={refreshing}
      />
    </div>
  )
}
