/** A signed-in user's saved channels. Both lists hold channel ids, newest first for `recent`. */
export interface Library {
  favorites: string[]
  recent: string[]
}

export interface AccountUser {
  username: string
}

/** GET /api/auth/me and the sign-in / create-account responses. */
export interface SessionResponse {
  user: AccountUser | null
  library?: Library
}

export const LIMITS = {
  favorites: 2000,
  recent: 50,
  idLength: 200,
} as const

/**
 * Combines the account's library with what was saved on this device before signing in.
 * Account entries come first; device-only entries are added after them.
 */
export function mergeLibraries(account: Library, device: Library): Library {
  const merge = (a: string[], b: string[], max: number) => [...new Set([...a, ...b])].slice(0, max)
  return {
    favorites: merge(account.favorites, device.favorites, LIMITS.favorites),
    recent: merge(account.recent, device.recent, LIMITS.recent),
  }
}
