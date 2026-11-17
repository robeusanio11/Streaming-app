import path from 'node:path'

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '127.0.0.1',
  /** The playlist loaded when the client doesn't ask for another one. Can be an http(s) URL or a local file path. */
  defaultPlaylistUrl: process.env.PLAYLIST_URL ?? 'https://iptv-org.github.io/iptv/index.m3u',
  /** How long a fetched playlist is reused before it is downloaded again. */
  playlistTtlMs: Number(process.env.PLAYLIST_TTL_HOURS ?? 6) * 3600_000,
  cacheDir: process.env.CACHE_DIR ?? path.resolve('.cache'),
  /**
   * The relay refuses private, loopback and link-local addresses so it can't be used to reach
   * the host's internal network. Set ALLOW_PRIVATE_HOSTS=1 only for local testing.
   */
  allowPrivateHosts: process.env.ALLOW_PRIVATE_HOSTS === '1',
  /** Sent upstream when a stream doesn't ask for a specific User-Agent. */
  defaultUserAgent:
    process.env.RELAY_USER_AGENT ??
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  /** How long to wait for upstream response headers. */
  upstreamTimeoutMs: Number(process.env.UPSTREAM_TIMEOUT_MS ?? 15_000),
}
