import { useCallback } from 'react'
import type { Channel } from '../../shared/channels'
import { useStoredState } from './storage'

/** What happened the last time each stream URL was tried in this browser. */
export type HealthMap = Record<string, { ok: boolean; at: number }>

const MAX_AGE = 24 * 3600_000

export type ChannelHealth = 'ok' | 'dead' | 'unknown'

export function channelHealth(ch: Channel, health: HealthMap): ChannelHealth {
  const now = Date.now()
  let tried = 0
  for (const s of ch.streams) {
    const h = health[s.url]
    if (!h || now - h.at > MAX_AGE) continue
    if (h.ok) return 'ok'
    tried++
  }
  return tried === ch.streams.length && tried > 0 ? 'dead' : 'unknown'
}

export function useStreamHealth() {
  const [health, setHealth] = useStoredState<HealthMap>('health', {})
  const record = useCallback(
    (url: string, ok: boolean) => {
      setHealth(prev => {
        const now = Date.now()
        const next: HealthMap = {}
        // Drop expired entries so storage doesn't keep growing.
        for (const [k, v] of Object.entries(prev)) if (now - v.at <= MAX_AGE) next[k] = v
        next[url] = { ok, at: now }
        return next
      })
    },
    [setHealth],
  )
  return { health, record }
}
