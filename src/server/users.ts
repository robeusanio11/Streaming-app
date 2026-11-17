import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { LIMITS, type Library } from '../shared/account.js'

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>

const SESSION_TTL_MS = 30 * 24 * 3600_000

interface UserRecord {
  id: string
  username: string
  /** "scrypt$<salt hex>$<hash hex>" */
  password: string
  createdAt: string
  library: Library
  libraryUpdatedAt: string
}

interface SessionRecord {
  userId: string
  expiresAt: number
}

interface DbFile {
  version: 1
  users: Record<string, UserRecord>
  /** Keyed by the SHA-256 of the session token, so a leaked file doesn't leak live sessions. */
  sessions: Record<string, SessionRecord>
}

export class AccountError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{2,31}$/

export function normalizeUsername(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

export function validateCredentials(username: string, password: unknown): string {
  if (!USERNAME_RE.test(username)) {
    throw new AccountError('Usernames are 3–32 characters: letters, numbers, dots, dashes or underscores.', 400)
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw new AccountError('Passwords need at least 8 characters.', 400)
  }
  if (password.length > 200) throw new AccountError('Passwords can be at most 200 characters.', 400)
  return password
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16)
  const hash = await scrypt(password, salt, 64)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, saltHex, hashHex] = stored.split('$')
  if (kind !== 'scrypt' || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length)
  return crypto.timingSafeEqual(actual, expected)
}

const tokenKey = (token: string) => crypto.createHash('sha256').update(token).digest('hex')

/** Keeps only valid, de-duplicated channel ids, newest-first order preserved, within the size limit. */
export function cleanIds(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of value) {
    if (typeof v !== 'string' || !v || v.length > LIMITS.idLength || seen.has(v)) continue
    seen.add(v)
    out.push(v)
    if (out.length >= max) break
  }
  return out
}

/**
 * Accounts, sessions and each user's library, stored in one JSON file.
 * Writes are queued and atomic (write to a temp file, then rename), so a crash never leaves a half-written file.
 */
export class UserStore {
  private db: DbFile | null = null
  private loading: Promise<DbFile> | null = null
  private writing: Promise<void> = Promise.resolve()
  private readonly file: string
  // A real hash to compare against when the username doesn't exist, so timing doesn't reveal which usernames exist.
  private readonly dummyHash = hashPassword(crypto.randomBytes(16).toString('hex'))

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'accounts.json')
  }

  private async load(): Promise<DbFile> {
    if (this.db) return this.db
    this.loading ??= (async () => {
      try {
        const parsed = JSON.parse(await fs.readFile(this.file, 'utf8')) as DbFile
        this.db = { version: 1, users: parsed.users ?? {}, sessions: parsed.sessions ?? {} }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
        this.db = { version: 1, users: {}, sessions: {} }
      }
      return this.db
    })()
    return this.loading
  }

  private save(): Promise<void> {
    const run = async () => {
      const db = await this.load()
      const now = Date.now()
      for (const [k, s] of Object.entries(db.sessions)) if (s.expiresAt < now) delete db.sessions[k]
      await fs.mkdir(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.${process.pid}.tmp`
      await fs.writeFile(tmp, JSON.stringify(db), { mode: 0o600 })
      await fs.rename(tmp, this.file)
    }
    this.writing = this.writing.then(run, run)
    return this.writing
  }

  private findByUsername(db: DbFile, username: string): UserRecord | undefined {
    return Object.values(db.users).find(u => u.username === username)
  }

  async register(rawUsername: unknown, rawPassword: unknown): Promise<UserRecord> {
    const username = normalizeUsername(rawUsername)
    const password = validateCredentials(username, rawPassword)
    const db = await this.load()
    if (this.findByUsername(db, username)) throw new AccountError('That username is taken. Pick another one.', 409)
    const hash = await hashPassword(password)
    // Check again: another request may have registered the same name while we were hashing.
    if (this.findByUsername(db, username)) throw new AccountError('That username is taken. Pick another one.', 409)
    const now = new Date().toISOString()
    const user: UserRecord = {
      id: crypto.randomUUID(),
      username,
      password: hash,
      createdAt: now,
      library: { favorites: [], recent: [] },
      libraryUpdatedAt: now,
    }
    db.users[user.id] = user
    await this.save()
    return user
  }

  async authenticate(rawUsername: unknown, rawPassword: unknown): Promise<UserRecord> {
    const username = normalizeUsername(rawUsername)
    const password = typeof rawPassword === 'string' ? rawPassword : ''
    const db = await this.load()
    const user = this.findByUsername(db, username)
    const ok = await verifyPassword(password, user?.password ?? (await this.dummyHash))
    if (!user || !ok) throw new AccountError('Wrong username or password.', 401)
    return user
  }

  async createSession(userId: string): Promise<{ token: string; expiresAt: number }> {
    const db = await this.load()
    const token = crypto.randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + SESSION_TTL_MS
    db.sessions[tokenKey(token)] = { userId, expiresAt }
    await this.save()
    return { token, expiresAt }
  }

  async userForSession(token: string | undefined): Promise<UserRecord | null> {
    if (!token) return null
    const db = await this.load()
    const s = db.sessions[tokenKey(token)]
    if (!s || s.expiresAt < Date.now()) return null
    return db.users[s.userId] ?? null
  }

  async deleteSession(token: string | undefined): Promise<void> {
    if (!token) return
    const db = await this.load()
    if (db.sessions[tokenKey(token)]) {
      delete db.sessions[tokenKey(token)]
      await this.save()
    }
  }

  async setLibrary(userId: string, patch: Partial<Record<keyof Library, unknown>>): Promise<Library> {
    const db = await this.load()
    const user = db.users[userId]
    if (!user) throw new AccountError('Account not found.', 404)
    if (patch.favorites !== undefined) user.library.favorites = cleanIds(patch.favorites, LIMITS.favorites)
    if (patch.recent !== undefined) user.library.recent = cleanIds(patch.recent, LIMITS.recent)
    user.libraryUpdatedAt = new Date().toISOString()
    await this.save()
    return user.library
  }

  async deleteUser(userId: string): Promise<void> {
    const db = await this.load()
    delete db.users[userId]
    for (const [k, s] of Object.entries(db.sessions)) if (s.userId === userId) delete db.sessions[k]
    await this.save()
  }
}
