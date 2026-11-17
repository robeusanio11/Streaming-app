import dns from 'node:dns/promises'
import net from 'node:net'
import { config } from './config.js'

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::' || lower === '::1') return true
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
  if (mapped) return isPrivateIPv4(mapped[1])
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(lower)
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip)
  if (net.isIPv6(ip)) return isPrivateIPv6(ip)
  return true
}

export class RelayError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

/** Throws a RelayError unless the URL is http(s) and points at a public address. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new RelayError(400, 'Invalid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RelayError(400, 'Only http and https URLs are allowed')
  }
  if (config.allowPrivateHosts) return url

  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = net.isIP(host)
    ? [host]
    : await dns
        .lookup(host, { all: true })
        .then(r => r.map(a => a.address))
        .catch(() => {
          throw new RelayError(502, `Could not resolve ${host}`)
        })
  if (addresses.some(isPrivateAddress)) {
    throw new RelayError(403, 'Private network addresses are not allowed')
  }
  return url
}

/**
 * fetch() that checks every redirect hop against assertPublicUrl, so a public URL can't
 * redirect the relay into a private network. The returned response's `url` is the final URL.
 */
export async function safeFetch(
  raw: string,
  init: RequestInit = {},
  maxRedirects = 5,
): Promise<Response & { finalUrl: string }> {
  let current = raw
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current)
    const res = await fetch(current, { ...init, redirect: 'manual' })
    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel()
      current = new URL(location, current).toString()
      continue
    }
    return Object.assign(res, { finalUrl: current })
  }
  throw new RelayError(508, 'Too many redirects')
}
