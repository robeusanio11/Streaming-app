import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import compression from 'compression'
import express from 'express'
import { config } from './config.js'
import { getPlaylist } from './playlist.js'
import { RELAY_PATH, relayHandler } from './proxy.js'

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
