import express, { type NextFunction, type Request, type Response } from 'express'
import type { SessionResponse } from '../shared/account.js'
import { AccountError, normalizeUsername, UserStore } from './users.js'

const COOKIE = 'sid'

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return undefined
}

function sessionCookie(req: Request, value: string, expiresAt: number): string {
  const parts = [`${COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax']
  parts.push(expiresAt > 0 ? `Expires=${new Date(expiresAt).toUTCString()}` : 'Max-Age=0')
  if (req.secure) parts.push('Secure')
  return parts.join('; ')
}

/**
 * Changes must be sent as JSON. A cross-site form can't send a JSON body without a CORS preflight,
 * which this server never approves, so this blocks cross-site request forgery along with SameSite=Lax.
 */
function requireJson(req: Request, res: Response, next: NextFunction) {
  if (!req.is('application/json')) {
    res.status(415).json({ error: 'Send the request as JSON.' })
    return
  }
  next()
}

/** Counts failures per key and blocks the key once it reaches the limit, until the window ends. */
class Throttle {
  private hits = new Map<string, { count: number; resetAt: number }>()
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  blocked(key: string): boolean {
    const h = this.hits.get(key)
    return !!h && h.resetAt > Date.now() && h.count >= this.max
  }
  fail(key: string) {
    const now = Date.now()
    const h = this.hits.get(key)
    if (!h || h.resetAt <= now) this.hits.set(key, { count: 1, resetAt: now + this.windowMs })
    else h.count++
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k)
  }
  clear(key: string) {
    this.hits.delete(key)
  }
}

export function authRouter(store: UserStore) {
  const router = express.Router()
  const json = express.json({ limit: '128kb' })
  // Wrong passwords: 10 per username, and a looser 50 per address so one person can't lock out a shared network.
  const userThrottle = new Throttle(10, 15 * 60_000)
  const ipThrottle = new Throttle(50, 15 * 60_000)
  const signUpThrottle = new Throttle(20, 60 * 60_000)

  const fail = (res: Response, err: unknown) => {
    if (err instanceof AccountError) {
      res.status(err.status).json({ error: err.message })
      return
    }
    console.error('[auth]', err)
    res.status(500).json({ error: 'Something went wrong on the server. Try again.' })
  }

  const startSession = async (req: Request, res: Response, userId: string) => {
    const { token, expiresAt } = await store.createSession(userId)
    res.setHeader('Set-Cookie', sessionCookie(req, token, expiresAt))
  }

  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })

  router.get('/auth/me', async (req, res) => {
    try {
      const user = await store.userForSession(readCookie(req, COOKIE))
      const body: SessionResponse = user ? { user: { username: user.username }, library: user.library } : { user: null }
      res.json(body)
    } catch (err) {
      fail(res, err)
    }
  })

  router.post('/auth/register', requireJson, json, async (req, res) => {
    const ip = req.ip ?? ''
    if (signUpThrottle.blocked(ip)) {
      res.status(429).json({ error: 'Too many new accounts from this address. Try again later.' })
      return
    }
    try {
      const user = await store.register(req.body?.username, req.body?.password)
      signUpThrottle.fail(ip) // counts every account created, not only failures
      await startSession(req, res, user.id)
      res.status(201).json({ user: { username: user.username }, library: user.library } satisfies SessionResponse)
    } catch (err) {
      fail(res, err)
    }
  })

  router.post('/auth/login', requireJson, json, async (req, res) => {
    const nameKey = `u:${normalizeUsername(req.body?.username)}`
    const ipKey = `ip:${req.ip ?? ''}`
    if (userThrottle.blocked(nameKey) || ipThrottle.blocked(ipKey)) {
      res.status(429).json({ error: 'Too many wrong passwords. Wait 15 minutes, then try again.' })
      return
    }
    try {
      const user = await store.authenticate(req.body?.username, req.body?.password)
      userThrottle.clear(nameKey)
      await startSession(req, res, user.id)
      res.json({ user: { username: user.username }, library: user.library } satisfies SessionResponse)
    } catch (err) {
      if (err instanceof AccountError && err.status === 401) {
        userThrottle.fail(nameKey)
        ipThrottle.fail(ipKey)
      }
      fail(res, err)
    }
  })

  router.post('/auth/logout', requireJson, async (req, res) => {
    try {
      await store.deleteSession(readCookie(req, COOKIE))
      res.setHeader('Set-Cookie', sessionCookie(req, '', 0))
      res.json({ user: null } satisfies SessionResponse)
    } catch (err) {
      fail(res, err)
    }
  })

  router.put('/library', requireJson, json, async (req, res) => {
    try {
      const user = await store.userForSession(readCookie(req, COOKIE))
      if (!user) {
        res.status(401).json({ error: 'You are signed out. Sign in again to save your channels.' })
        return
      }
      const library = await store.setLibrary(user.id, {
        favorites: req.body?.favorites,
        recent: req.body?.recent,
      })
      res.json({ library })
    } catch (err) {
      fail(res, err)
    }
  })

  router.delete('/auth/account', requireJson, json, async (req, res) => {
    try {
      const token = readCookie(req, COOKIE)
      const user = await store.userForSession(token)
      if (!user) {
        res.status(401).json({ error: 'You are signed out.' })
        return
      }
      // Ask for the password again so a borrowed, signed-in browser can't delete the account.
      await store.authenticate(user.username, req.body?.password).catch(() => {
        throw new AccountError('That password is wrong, so the account was not deleted.', 403)
      })
      await store.deleteUser(user.id)
      res.setHeader('Set-Cookie', sessionCookie(req, '', 0))
      res.json({ user: null } satisfies SessionResponse)
    } catch (err) {
      fail(res, err)
    }
  })

  return router
}
