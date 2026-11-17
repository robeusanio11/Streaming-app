/** Path of the server's stream relay. The client and the HLS manifest rewriter both use it. */
export const RELAY_PATH = '/api/relay'

export interface RelayOptions {
  referrer?: string
  userAgent?: string
}

/** The relay URL for an upstream stream URL, with any headers the stream needs. */
export function relayUrl(upstream: string, opts: RelayOptions = {}): string {
  const q = new URLSearchParams({ url: upstream })
  if (opts.referrer) q.set('ref', opts.referrer)
  if (opts.userAgent) q.set('ua', opts.userAgent)
  return `${RELAY_PATH}?${q}`
}
