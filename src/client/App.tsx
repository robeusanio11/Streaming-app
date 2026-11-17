import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Channel, ChannelData } from '../shared/channels'
import { AccountButton, AccountDialog } from './components/Account'
import { ChannelList } from './components/ChannelList'
import { Guide } from './components/Guide'
import { NowNext } from './components/NowNext'
import { Player, type PlaybackMode } from './components/Player'
import { Settings } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import { AccountProvider, useAccount } from './lib/account'
import { fetchDefaultPlaylistUrl, fetchPlaylist } from './lib/api'
import { EpgProvider, useEpg } from './lib/epg'
import { CategoryChips } from './components/CategoryChips'
import { countBy, emptyFilters, filterChannels, initialFilters, normalizeFilters, type Filters } from './lib/filter'
import { useStreamHealth } from './lib/health'
import { useStoredState } from './lib/storage'

const MAX_RECENT = 50
const DEFAULT_HOME = 'us'

type Mode = 'watch' | 'guide'

/** Loads the playlist and provides TV guide data to the rest of the app. */
export function App() {
  const [playlistUrl, setPlaylistUrl] = useStoredState('playlistUrl', '')
  const [epgSources, setEpgSources] = useStoredState<string[]>('epgSources', [])
  const [defaultUrl, setDefaultUrl] = useState('')
  const [data, setData] = useState<ChannelData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

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

  return (
    <AccountProvider>
      <EpgProvider playlistUrl={playlistUrl} sources={epgSources} ready={!!data && !loading}>
        <Shell
          data={data}
          loading={loading}
          refreshing={refreshing}
          error={error}
          reload={load}
          playlistUrl={playlistUrl}
          setPlaylistUrl={setPlaylistUrl}
          defaultUrl={defaultUrl}
          epgSources={epgSources}
          setEpgSources={setEpgSources}
        />
      </EpgProvider>
    </AccountProvider>
  )
}

interface ShellProps {
  data: ChannelData | null
  loading: boolean
  refreshing: boolean
  error: string
  reload: (refresh?: boolean) => void
  playlistUrl: string
  setPlaylistUrl: (u: string) => void
  defaultUrl: string
  epgSources: string[]
  setEpgSources: (u: string[]) => void
}

function Shell(props: ShellProps) {
  const { data, loading, refreshing, error, reload } = props
  const [homeCountry, setHomeCountry] = useStoredState('homeCountry', DEFAULT_HOME)
  const [storedFilters, setFilters] = useStoredState<Filters>('filters', initialFilters(DEFAULT_HOME))
  // Saved filters from an older version may be missing newer fields.
  const filters = useMemo(() => normalizeFilters(storedFilters), [storedFilters])
  const { favorites, setFavorites, recent, setRecent } = useAccount()
  const [mode, setMode] = useStoredState<PlaybackMode>('playbackMode', 'auto')
  const [view, setView] = useStoredState<Mode>('view', 'watch')
  const [guideShowAll, setGuideShowAll] = useStoredState('guideShowAll', false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { health, record } = useStreamHealth()
  const { coverage, coverageLoaded } = useEpg()

  const channels = data?.channels ?? []
  const deferredSearch = useDeferredValue(filters.search)
  const effective = useMemo(() => ({ ...filters, search: deferredSearch }), [filters, deferredSearch])
  const ctx = useMemo(
    () => ({ favorites, recent, health, guide: coverage, homeCountry }),
    [favorites, recent, health, coverage, homeCountry],
  )

  const visible = useMemo(() => filterChannels(channels, effective, ctx), [channels, effective, ctx])
  const guideChannels = useMemo(
    () => (guideShowAll ? visible : visible.filter(c => coverage.has(c.id))),
    [visible, coverage, guideShowAll],
  )
  const categoryCounts = useMemo(
    () => countBy(filterChannels(channels, effective, ctx, { category: true }), c => c.categories),
    [channels, effective, ctx],
  )
  const countryKey = (c: Channel) => (c.country ? [c.country] : [])
  const countryCounts = useMemo(
    () => countBy(filterChannels(channels, effective, ctx, { country: true }), countryKey),
    [channels, effective, ctx],
  )
  const allCountryCounts = useMemo(
    () => countBy(filterChannels(channels, effective, ctx, { country: true, region: true }), countryKey),
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
  const playlistCountries = useMemo(
    () => [...new Set(channels.map(c => c.country).filter((c): c is string => !!c))],
    [channels],
  )

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
    (filters.categories.length ? 1 : 0) +
    (filters.region ? 1 : 0) +
    (filters.country ? 1 : 0) +
    (filters.hideGeoBlocked ? 1 : 0) +
    (filters.hideNot247 ? 1 : 0) +
    (filters.hideFailed ? 1 : 0) +
    (filters.withGuide ? 1 : 0)

  const listBody = error ? (
    <div className="list empty error">
      <p>{error}</p>
      <button className="btn" onClick={() => reload()}>
        Try again
      </button>
    </div>
  ) : loading ? (
    <div className="list empty">
      <div className="spinner" aria-hidden />
      <p>Downloading and sorting channels. The first load can take a few seconds.</p>
    </div>
  ) : null

  return (
    <div className={`app ${sidebarOpen ? 'sidebar-open' : ''} view-${view}`}>
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
        <nav className="tabs" aria-label="Sections">
          <button className={`tab ${view === 'watch' ? 'active' : ''}`} onClick={() => setView('watch')}>
            Watch
          </button>
          <button className={`tab ${view === 'guide' ? 'active' : ''}`} onClick={() => setView('guide')}>
            <span className="hide-mobile">TV </span>Guide
          </button>
        </nav>
        <input
          className="input search"
          type="search"
          placeholder={`Search ${channels.length.toLocaleString()} channels`}
          value={filters.search}
          onChange={e => setFilters(f => ({ ...normalizeFilters(f), search: e.target.value }))}
        />
        <AccountButton onClick={() => setAccountOpen(true)} />
        <button className="btn ghost settings-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings">
          <span aria-hidden>⚙</span>
          <span className="settings-label">Settings</span>
        </button>
      </header>

      <Sidebar
        filters={filters}
        setFilters={fn => setFilters(f => fn(normalizeFilters(f)))}
        categoryCounts={categoryCounts}
        countryCounts={countryCounts}
        allCountryCounts={allCountryCounts}
        viewCounts={viewCounts}
        homeCountry={homeCountry}
        guideCount={coverageLoaded ? coverage.size : null}
      />
      <div className="scrim only-mobile" onClick={() => setSidebarOpen(false)} />

      {view === 'guide' ? (
        <main className="content guide-content">
          {!listBody && (
            <CategoryChips
              selected={filters.categories}
              counts={categoryCounts}
              onChange={categories => setFilters(f => ({ ...normalizeFilters(f), categories }))}
            />
          )}
          {listBody ?? (
            <Guide
              channels={guideChannels}
              selectedId={selectedId}
              showAll={guideShowAll}
              onShowAll={setGuideShowAll}
              onPlay={ch => {
                select(ch)
                setView('watch')
              }}
            />
          )}
        </main>
      ) : (
        <main className="content">
          <Player
            key={`${selected?.id ?? 'none'}|${mode}`}
            channel={selected}
            mode={mode}
            onResult={record}
            onPrev={() => step(-1)}
            onNext={() => step(1)}
          >
            {selected && <NowNext channel={selected} onOpenGuide={() => setView('guide')} />}
          </Player>

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
                  <button className="link" onClick={() => setFilters(() => emptyFilters)}>
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
            {!listBody && (
              <CategoryChips
              selected={filters.categories}
              counts={categoryCounts}
              onChange={categories => setFilters(f => ({ ...normalizeFilters(f), categories }))}
            />
            )}
            {listBody ?? (
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
      )}

      <AccountDialog open={accountOpen} onClose={() => setAccountOpen(false)} />
      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        playlistUrl={props.playlistUrl}
        defaultPlaylistUrl={props.defaultUrl}
        onPlaylistUrl={url => {
          props.setPlaylistUrl(url)
          setSettingsOpen(false)
        }}
        mode={mode}
        onMode={setMode}
        fetchedAt={data?.fetchedAt}
        onRefresh={() => reload(true)}
        refreshing={refreshing}
        homeCountry={homeCountry}
        onHomeCountry={setHomeCountry}
        countries={playlistCountries}
        epgSources={props.epgSources}
        onEpgSources={props.setEpgSources}
      />
    </div>
  )
}
