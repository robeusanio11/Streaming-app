import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { LIMITS, mergeLibraries, type AccountUser, type Library, type SessionResponse } from '../../shared/account'
import { useStoredState } from './storage'

type Update = string[] | ((prev: string[]) => string[])

export type SyncState = 'idle' | 'saving' | 'saved' | 'error'

interface AccountState {
  /** 'loading' until the server has said whether this browser is signed in. */
  status: 'loading' | 'guest' | 'signed-in'
  user: AccountUser | null
  sync: SyncState
  syncError: string
  favorites: string[]
  recent: string[]
  setFavorites: (u: Update) => void
  setRecent: (u: Update) => void
  signIn: (username: string, password: string) => Promise<void>
  register: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  deleteAccount: (password: string) => Promise<void>
}

const AccountContext = createContext<AccountState | null>(null)

export function useAccount(): AccountState {
  const ctx = useContext(AccountContext)
  if (!ctx) throw new Error('useAccount must be used inside <AccountProvider>')
  return ctx
}

async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    credentials: 'same-origin',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error((data as { error?: string }).error || `The server answered HTTP ${res.status}.`)
    ;(err as Error & { status?: number }).status = res.status
    throw err
  }
  return data as T
}

const SAVE_DELAY_MS = 600
const same = (a: Library, b: Library) =>
  a.favorites.join('\n') === b.favorites.join('\n') && a.recent.join('\n') === b.recent.join('\n')

/**
 * Favourites and recently watched channels. Guests keep them in this browser.
 * Signed-in users keep them in their account; changes are saved shortly after they happen.
 */
export function AccountProvider({ children }: { children: ReactNode }) {
  const [deviceFavorites, setDeviceFavorites] = useStoredState<string[]>('favorites', [])
  const [deviceRecent, setDeviceRecent] = useStoredState<string[]>('recent', [])
  const [status, setStatus] = useState<AccountState['status']>('loading')
  const [user, setUser] = useState<AccountUser | null>(null)
  const [library, setLibrary] = useState<Library>({ favorites: [], recent: [] })
  const [sync, setSync] = useState<SyncState>('idle')
  const [syncError, setSyncError] = useState('')

  const pending = useRef<Library | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const deviceRef = useRef<Library>({ favorites: deviceFavorites, recent: deviceRecent })
  deviceRef.current = { favorites: deviceFavorites, recent: deviceRecent }

  const becomeGuest = useCallback((message = '') => {
    window.clearTimeout(timer.current)
    pending.current = null
    setUser(null)
    setLibrary({ favorites: [], recent: [] })
    setStatus('guest')
    setSync(message ? 'error' : 'idle')
    setSyncError(message)
  }, [])

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current)
    const next = pending.current
    if (!next) return
    pending.current = null
    setSync('saving')
    try {
      await send('PUT', '/api/library', next)
      if (!pending.current) setSync('saved')
      setSyncError('')
    } catch (err) {
      if ((err as { status?: number }).status === 401) {
        becomeGuest('You were signed out, so recent changes were not saved. Sign in again.')
        return
      }
      // Keep the change so the next edit, or the next flush, retries it.
      pending.current ??= next
      setSync('error')
      setSyncError(`Couldn't save to your account: ${(err as Error).message}`)
    }
  }, [becomeGuest])

  const schedule = useCallback(
    (next: Library) => {
      pending.current = next
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(flush, SAVE_DELAY_MS)
    },
    [flush],
  )

  // Save anything still waiting when the tab is hidden or closed.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== 'hidden' || !pending.current) return
      const body = JSON.stringify(pending.current)
      pending.current = null
      window.clearTimeout(timer.current)
      fetch('/api/library', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(
        () => {},
      )
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [])

  /** Uses the account's library, adding anything saved on this device first, then clears the device copy. */
  const adopt = useCallback(
    async (res: SessionResponse) => {
      if (!res.user) return becomeGuest()
      const account = res.library ?? { favorites: [], recent: [] }
      const merged = mergeLibraries(account, deviceRef.current)
      setUser(res.user)
      setLibrary(merged)
      setStatus('signed-in')
      setSync('idle')
      setSyncError('')
      if (!same(merged, account)) {
        pending.current = merged
        await flush()
      }
      setDeviceFavorites([])
      setDeviceRecent([])
    },
    [becomeGuest, flush, setDeviceFavorites, setDeviceRecent],
  )

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(r => (r.ok ? (r.json() as Promise<SessionResponse>) : { user: null }))
      .then(res => {
        if (!cancelled) return adopt(res)
      })
      .catch(() => {
        if (!cancelled) becomeGuest()
      })
    return () => {
      cancelled = true
    }
    // Only on first load: later sign-ins go through signIn/register.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const update = useCallback(
    (key: keyof Library, max: number, u: Update) => {
      setLibrary(prev => {
        const value = (typeof u === 'function' ? u(prev[key]) : u).slice(0, max)
        const next = { ...prev, [key]: value }
        schedule(next)
        return next
      })
    },
    [schedule],
  )

  const signedIn = status === 'signed-in'
  const setFavorites = useCallback(
    (u: Update) => (signedIn ? update('favorites', LIMITS.favorites, u) : setDeviceFavorites(u)),
    [signedIn, update, setDeviceFavorites],
  )
  const setRecent = useCallback(
    (u: Update) => (signedIn ? update('recent', LIMITS.recent, u) : setDeviceRecent(u)),
    [signedIn, update, setDeviceRecent],
  )

  const signIn = useCallback(
    async (username: string, password: string) =>
      adopt(await send<SessionResponse>('POST', '/api/auth/login', { username, password })),
    [adopt],
  )
  const register = useCallback(
    async (username: string, password: string) =>
      adopt(await send<SessionResponse>('POST', '/api/auth/register', { username, password })),
    [adopt],
  )
  const signOut = useCallback(async () => {
    await flush()
    await send('POST', '/api/auth/logout').catch(() => {})
    becomeGuest()
  }, [flush, becomeGuest])
  const deleteAccount = useCallback(
    async (password: string) => {
      await send('DELETE', '/api/auth/account', { password })
      becomeGuest()
    },
    [becomeGuest],
  )

  const value = useMemo<AccountState>(
    () => ({
      status,
      user,
      sync,
      syncError,
      favorites: signedIn ? library.favorites : deviceFavorites,
      recent: signedIn ? library.recent : deviceRecent,
      setFavorites,
      setRecent,
      signIn,
      register,
      signOut,
      deleteAccount,
    }),
    [status, user, sync, syncError, signedIn, library, deviceFavorites, deviceRecent, setFavorites, setRecent, signIn, register, signOut, deleteAccount],
  )

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
}
