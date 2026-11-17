import { Readable } from 'node:stream'
import type { Request, Response } from 'express'
import { config } from './config.js'
import { RelayError, safeFetch } from './net.js'
import { relayUrl, type RelayOptions } from '../shared/relay.js'

export { RELAY_PATH } from '../shared/relay.js'

const MANIFEST_TYPES = /mpegurl|vnd\.apple\.mpegurl/i
const URI_ATTR = /URI="([^"]+)"/g

/**
 * Rewrites every URI in an HLS playlist (variant streams, segments, keys, init maps,
 * alternate renditions) to point back at the relay, with the same headers.
 */
export function rewriteManifest(body: string, baseUrl: string, opts: RelayOptions): string {
  const abs = (u: string) => {
    try {
      return relayUrl(new URL(u, baseUrl).toString(), opts)
    } catch {
      return u
    }
  }
  return body
    .split(/\r?\n/)
    .map(line => {
      const t = line.trim()
      if (!t) return line
      if (t.startsWith('#')) return t.includes('URI="') ? t.replace(URI_ATTR, (_, u) => `URI="${abs(u)}"`) : line
      return abs(t)
    })
    .join('\n')
}

function looksLikeManifest(contentType: string, url: string): boolean {
  if (MANIFEST_TYPES.test(contentType)) return true
  try {
    return /\.m3u8?$/i.test(new URL(url).pathname)
  } catch {
    return false
  }
}

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']

export async function relayHandler(req: Request, res: Response): Promise<void> {
  const target = typeof req.query.url === 'string' ? req.query.url : ''
  const opts: RelayOptions = {
    referrer: typeof req.query.ref === 'string' ? req.query.ref : undefined,
    userAgent: typeof req.query.ua === 'string' ? req.query.ua : undefined,
  }
  if (!target) {
    res.status(400).json({ error: 'Missing url parameter' })
    return
  }

  const controller = new AbortController()
  // Abort the upstream request if the player goes away (channel change, tab closed).
  res.on('close', () => controller.abort())
  // Time out only while waiting for headers. Live TS streams can stay open for a long time.
  const headerTimer = setTimeout(() => controller.abort(), config.upstreamTimeoutMs)

  try {
    const headers: Record<string, string> = {
      'User-Agent': opts.userAgent || config.defaultUserAgent,
      Accept: '*/*',
    }
    if (opts.referrer) {
      headers.Referer = opts.referrer
      try {
        headers.Origin = new URL(opts.referrer).origin
      } catch {
        /* ignore */
      }
    }
    if (req.headers.range) headers.Range = req.headers.range

    const upstream = await safeFetch(target, { headers, signal: controller.signal })
    clearTimeout(headerTimer)

    res.status(upstream.status)
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('X-Upstream-Status', String(upstream.status))

    const contentType = upstream.headers.get('content-type') ?? ''

    if (upstream.ok && looksLikeManifest(contentType, upstream.finalUrl)) {
      const text = await upstream.text()
      if (text.trimStart().startsWith('#EXTM3U')) {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
        res.setHeader('Cache-Control', 'no-store')
        res.send(rewriteManifest(text, upstream.finalUrl, opts))
        return
      }
      // It looked like a manifest but isn't one, so send it unchanged.
      if (contentType) res.setHeader('Content-Type', contentType)
      res.send(text)
      return
    }

    // Some servers serve manifests as text/plain or octet-stream from paths that don't end in
    // .m3u8. Check the first bytes of small, non-media responses.
    const length = Number(upstream.headers.get('content-length') ?? NaN)
    if (upstream.ok && !/^(video|audio)\//i.test(contentType) && (!Number.isFinite(length) || length < 512_000)) {
      const reader = upstream.body?.getReader()
      if (reader) {
        const first = await reader.read()
        const chunk = first.value ?? new Uint8Array()
        const head = Buffer.from(chunk).toString('utf8', 0, Math.min(chunk.length, 16))
        if (head.trimStart().startsWith('#EXTM3U')) {
          const rest: Uint8Array[] = [chunk]
          for (let r = await reader.read(); !r.done; r = await reader.read()) rest.push(r.value)
          const text = Buffer.concat(rest).toString('utf8')
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
          res.setHeader('Cache-Control', 'no-store')
          res.send(rewriteManifest(text, upstream.finalUrl, opts))
          return
        }
        for (const h of PASS_HEADERS) {
          const v = upstream.headers.get(h)
          if (v) res.setHeader(h, v)
        }
        res.write(chunk)
        const restStream = new ReadableStream<Uint8Array>({
          async pull(c) {
            const r = await reader.read()
            if (r.done) c.close()
            else c.enqueue(r.value)
          },
          cancel: () => reader.cancel(),
        })
        Readable.fromWeb(restStream as never).on('error', () => res.destroy()).pipe(res)
        return
      }
    }

    for (const h of PASS_HEADERS) {
      const v = upstream.headers.get(h)
      if (v) res.setHeader(h, v)
    }
    if (!upstream.body) {
      res.end()
      return
    }
    Readable.fromWeb(upstream.body as never).on('error', () => res.destroy()).pipe(res)
  } catch (err) {
    clearTimeout(headerTimer)
    if (res.headersSent) {
      res.destroy()
      return
    }
    if (err instanceof RelayError) {
      res.status(err.status).json({ error: err.message })
    } else if (controller.signal.aborted) {
      if (!res.writableEnded && !req.destroyed) res.status(504).json({ error: 'Upstream timed out' })
    } else {
      const cause = (err as { cause?: { code?: string } }).cause?.code
      res.status(502).json({ error: `Upstream request failed${cause ? ` (${cause})` : ''}` })
    }
  }
}
