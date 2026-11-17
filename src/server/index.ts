import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import compression from 'compression'
import express from 'express'
import { config } from './config.js'
import { builtInCoverage, extraCoverage, getProgrammes } from './epg.js'
import { getPlaylist } from './playlist.js'
import { RELAY_PATH, relayHandler } from './proxy.js'
import type { EpgRequest, EpgResponse } from '../shared/epg.js'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')

  // Compress the API, but not the relay: video is already compressed, and buffering it adds latency.
  const compress = compression()

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.get('/api/config', (_req, res) => {
    res.json({ defaultPlaylistUrl: config.defaultPlaylistUrl })
  })

  app.get('/api/playlist', compress, async (req, res) => {
    const requested = typeof req.query.url === 'string' && req.query.url.trim() ? req.query.url.trim() : undefined
    if (requested && !/^https?:\/\//i.test(requested)) {
      res.status(400).json({ error: 'Playlist URL must start with http:// or https://' })
      return
    }
    try {
      const data = await getPlaylist(requested ?? config.defaultPlaylistUrl, req.query.refresh === '1')
      res.setHeader('Cache-Control', 'no-cache')
      res.json(data)
    } catch (err) {
      console.error('[playlist]', err)
      res.status(502).json({ error: (err as Error).message || 'Could not load playlist' })
    }
  })

  /** Extra XMLTV sources: the playlist's own x-tvg-url, the server's EPG_URLS, then the user's. */
  const extraSources = (playlistEpg: string[], fromClient: unknown): string[] => {
    const user = (Array.isArray(fromClient) ? fromClient : typeof fromClient === 'string' ? fromClient.split(',') : [])
      .map(s => String(s).trim())
      .filter(s => /^https?:\/\//i.test(s))
    return [...new Set([...playlistEpg, ...config.extraEpgUrls, ...user])].slice(0, 10)
  }

  const playlistParam = (v: unknown) => (typeof v === 'string' && /^https?:\/\//i.test(v.trim()) ? v.trim() : undefined)

  app.get('/api/epg/coverage', compress, async (req, res) => {
    try {
      const data = await getPlaylist(playlistParam(req.query.url) ?? config.defaultPlaylistUrl)
      const sources = extraSources(data.epgUrls, req.query.sources)
      const [builtIn, extra] = await Promise.all([
        builtInCoverage(data.channels).catch(() => [] as string[]),
        sources.length ? extraCoverage(data.channels, sources) : Promise.resolve([] as string[]),
      ])
      res.setHeader('Cache-Control', 'private, max-age=600')
      res.json({ ids: [...new Set([...builtIn, ...extra])] })
    } catch (err) {
      res.status(502).json({ error: (err as Error).message })
    }
  })

  app.post('/api/epg', express.json({ limit: '256kb' }), compress, async (req, res) => {
    const body = (req.body ?? {}) as Partial<EpgRequest> & { sources?: unknown }
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, 500) : []
    const now = Date.now()
    const from = Number.isFinite(body.from) ? Number(body.from) : now - 3600_000
    const to = Number.isFinite(body.to) ? Math.min(Number(body.to), from + 48 * 3600_000) : now + 12 * 3600_000
    try {
      const data = await getPlaylist(playlistParam(body.playlistUrl) ?? config.defaultPlaylistUrl)
      const wanted = new Set(ids)
      const channels = data.channels.filter(c => wanted.has(c.id))
      const programmes = await getProgrammes(channels, from, to, extraSources(data.epgUrls, body.sources))
      res.json({ programmes } satisfies EpgResponse)
    } catch (err) {
      console.error('[epg]', err)
      res.status(502).json({ error: (err as Error).message })
    }
  })

  app.get(RELAY_PATH, relayHandler)

  // In production, the built client is served from the same server.
  const here = path.dirname(fileURLToPath(import.meta.url))
  const clientDir = [path.resolve(here, '../../client'), path.resolve('dist/client')].find(d =>
    fs.existsSync(path.join(d, 'index.html')),
  )
  if (clientDir) {
    app.use(express.static(clientDir, { index: 'index.html', maxAge: '1h' }))
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(clientDir, 'index.html')))
  }

  return app
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  createApp().listen(config.port, config.host, () => {
    console.log(`Streaming app server on http://${config.host}:${config.port}`)
    console.log(`Default playlist: ${config.defaultPlaylistUrl}`)
  })
}
