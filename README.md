# Streaming App

A web app for browsing, filtering and playing the public IPTV channels in the
[iptv-org](https://github.com/iptv-org/iptv) playlist
(`https://iptv-org.github.io/iptv/index.m3u`) or any other M3U playlist.

- Loads about 18,700 streams and merges them into about 13,000 channels, each with its fallback streams.
- Filters by category, country and status (geo-blocked, part-time, failed for you), with instant search.
- Plays HLS in the browser with [hls.js](https://github.com/video-dev/hls.js). If a stream fails, the player moves on to the channel's next one.
- Includes favorites, recently watched, previous/next channel, a random channel button and arrow-key navigation in the list.
- A built-in **relay** fetches streams through the server, so channels play even when the stream server blocks
  browsers (no CORS), uses plain `http://` or needs a particular `Referer` or `User-Agent`.

## Running it

Requires Node 20 or later.

```bash
npm install
npm run dev        # Vite on http://localhost:5173 plus the API/relay on :8787
```

Production:

```bash
npm run build
npm start          # serves the app and API on http://127.0.0.1:8787
```

### Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `8787` / `127.0.0.1` | Where the server listens. Use `HOST=0.0.0.0` to allow other devices to connect. |
| `PLAYLIST_URL` | iptv-org `index.m3u` | Default playlist. Can be a URL or a local file path. |
| `PLAYLIST_TTL_HOURS` | `6` | How long a downloaded playlist is reused. It is cached in `.cache/`. |
| `UPSTREAM_TIMEOUT_MS` | `15000` | How long the relay waits for a stream server to respond. |
| `RELAY_USER_AGENT` | a desktop Chrome UA | User-Agent sent when a stream doesn't need a specific one. |
| `ALLOW_PRIVATE_HOSTS` | off | Lets the relay reach LAN/localhost addresses. Use only for testing. |

Users can also choose another playlist URL and a playback mode (automatic, always relay, never relay)
under **Settings** in the app.

## How it works

```
browser ──/api/playlist──▶ server ──▶ downloads + parses M3U, groups by channel, caches
browser ──/api/relay?url=…&ref=…&ua=…──▶ server ──▶ stream host (with the stream's headers)
                                          └─ HLS manifests are rewritten so every segment,
                                             key and variant also goes through the relay
```

| Path | What it does |
|---|---|
| `src/shared/m3u.ts` | M3U parser: attributes, `#EXTVLCOPT` headers, quality, and `[Geo-blocked]` / `[Not 24/7]` labels |
| `src/shared/channels.ts` | Groups entries into channels and orders each channel's streams best first |
| `src/server/playlist.ts` | Downloads and caches the playlist. If a download fails and a cached copy exists, it serves the cached copy. |
| `src/server/proxy.ts` | Stream relay and HLS manifest rewriting |
| `src/server/net.ts` | Blocks private and loopback addresses, including on every redirect hop |
| `src/client/` | React UI: virtualized channel list, filters and player with failover |

In **automatic** mode the player tries a stream directly first when the browser is able to, then through the relay.
If both fail, it moves to the channel's next stream. Results are remembered in the browser for 24 hours, so
channels that failed can be hidden.

## Known limitations

- Many streams in the public list are offline or geo-blocked. That comes from the source list, not the app.
- DASH (`.mpd`) streams, about 1% of the list, are skipped for now.
- With the relay, all video passes through the server, so its bandwidth matters if several people use it.
  The relay is an open fetcher for public URLs. Don't expose it to the internet without adding authentication.

## Moving to Electron later

The client only talks to `/api/*`. An Electron build can run the same Express server
(`createApp()` from `src/server/index.ts`) in the main process on a local port and load the UI from it.
The relay could later be replaced by Electron's own request handling, which can set headers per request
and has no CORS limits.

## Tests

```bash
npm test           # parser, grouping, manifest rewriting, address blocking
npm run typecheck
```
