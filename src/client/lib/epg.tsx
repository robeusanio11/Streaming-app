import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { EpgResponse, Programme } from '../../shared/epg'

const STALE_MS = 30 * 60_000
const BATCH = 150

interface Entry {
  list: Programme[]
  at: number
}

interface EpgState {
  /** Channel ids that have guide data available. */
  coverage: Set<string>
  coverageLoaded: boolean
  /** Programmes for a channel: undefined while unknown, [] when there are none. */
  get: (id: string) => Programme[] | undefined
  /** Ask for these channels' programmes. Cheap to call repeatedly: known and in-flight ids are skipped. */
  request: (ids: string[]) => void
  /** Current time, updated every 30 seconds so progress bars and "on now" move. */
  now: number
  /** Changes whenever new programmes arrive. */
  version: number
}

const EpgContext = createContext<EpgState | null>(null)

export function useEpg(): EpgState {
  const ctx = useContext(EpgContext)
  if (!ctx) throw new Error('useEpg must be used inside <EpgProvider>')
  return ctx
}

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(t)
  }, [intervalMs])
  return now
}

export function EpgProvider({
  playlistUrl,
  sources,
  ready,
  children,
}: {
  playlistUrl: string
  sources: string[]
  /** False until the playlist has loaded. */
  ready: boolean
  children: ReactNode
}) {
  const now = useNow()
  const [coverage, setCoverage] = useState<Set<string>>(new Set())
  const [coverageLoaded, setCoverageLoaded] = useState(false)
  const [version, setVersion] = useState(0)
  const cache = useRef(new Map<string, Entry>())
  const inflight = useRef(new Set<string>())
  const queue = useRef(new Set<string>())
  const timer = useRef<number | undefined>(undefined)
  const sourcesKey = sources.join(',')

  // Start over when the playlist or guide sources change.
  useEffect(() => {
    cache.current.clear()
    queue.current.clear()
    setVersion(v => v + 1)
    if (!ready) return
    setCoverageLoaded(false)
    const q = new URLSearchParams()
    if (playlistUrl) q.set('url', playlistUrl)
    if (sourcesKey) q.set('sources', sourcesKey)
    let cancelled = false
    fetch(`/api/epg/coverage?${q}`)
      .then(r => (r.ok ? r.json() : { ids: [] }))
      .then((body: { ids: string[] }) => {
        if (!cancelled) setCoverage(new Set(body.ids))
      })
      .catch(() => {})
      .finally(() => !cancelled && setCoverageLoaded(true))
    return () => {
      cancelled = true
    }
  }, [playlistUrl, sourcesKey, ready])

  const flush = useCallback(async () => {
    timer.current = undefined
    const ids = [...queue.current]
    queue.current.clear()
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH)
      chunk.forEach(id => inflight.current.add(id))
      const from = Date.now() - 2 * 3600_000
      try {
        const res = await fetch('/api/epg', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playlistUrl: playlistUrl || undefined,
            ids: chunk,
            from,
            to: from + 26 * 3600_000,
            sources: sourcesKey ? sourcesKey.split(',') : undefined,
          }),
        })
        const body = (await res.json()) as EpgResponse
        const at = Date.now()
        for (const id of chunk) cache.current.set(id, { list: res.ok ? (body.programmes[id] ?? []) : [], at })
      } catch {
        // Try again on the next request for these channels.
      } finally {
        chunk.forEach(id => inflight.current.delete(id))
        setVersion(v => v + 1)
      }
    }
  }, [playlistUrl, sourcesKey])

  const request = useCallback(
    (ids: string[]) => {
      const t = Date.now()
      let added = false
      for (const id of ids) {
        if (!coverage.has(id) || inflight.current.has(id) || queue.current.has(id)) continue
        const e = cache.current.get(id)
        if (e && t - e.at < STALE_MS) continue
        queue.current.add(id)
        added = true
      }
      // Batch requests from rows that appear at about the same time (e.g. while scrolling).
      if (added && timer.current === undefined) timer.current = window.setTimeout(flush, 120)
    },
    // Depends on coverage so callers ask again once it has loaded.
    [flush, coverage],
  )

  const get = useCallback((id: string) => cache.current.get(id)?.list, [])

  const value = useMemo<EpgState>(
    () => ({ coverage, coverageLoaded, get, request, now, version }),
    [coverage, coverageLoaded, get, request, now, version],
  )
  return <EpgContext.Provider value={value}>{children}</EpgContext.Provider>
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function formatRange(p: Programme): string {
  return `${formatTime(p.start)} – ${formatTime(p.stop)}`
}
