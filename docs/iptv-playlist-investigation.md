# What's in the iptv-org playlist

Source link: `https://iptv-org.github.io/iptv/index.m3u`

## What the link is

- It's a single, large **M3U playlist file**. It is not a stream. VLC downloads it, starts the first entry and loads the rest into its playlist view.
- It's built automatically from the public GitHub repo [iptv-org/iptv](https://github.com/iptv-org/iptv), which has ~326 source files in `streams/` (one per country or provider, e.g. `us.m3u`, `us_pluto.m3u`). A GitHub Action regenerates and republishes it on GitHub Pages several times a day.
- Size: about **18,700 stream entries** (NSFW channels are excluded). It's CC0 licensed. It holds only links to third-party streams and hosts no video itself.

## Entry format

The generator code is `scripts/models/stream.ts` → `toString()`. Each channel takes 2–4 lines:

```
#EXTM3U x-tvg-url="https://...guide.xml.gz,..."
#EXTINF:-1 tvg-id="France3.fr@NordPasdeCalaisHD" tvg-logo="https://.../logo.png" http-referrer="https://x/" http-user-agent="Mozilla/..." group-title="General;News",France 3 Nord Pas-de-Calais (720p) [Geo-blocked]
#EXTVLCOPT:http-referrer=https://x/
#EXTVLCOPT:http-user-agent=Mozilla/...
https://stream.host/path/index.m3u8
```

| Piece | Meaning / how to use it |
|---|---|
| `x-tvg-url` (header line) | Comma-separated list of EPG (XMLTV) guide URLs. Optional, for a TV-guide feature. |
| `tvg-id` | `ChannelId.cc@FeedId`. The `.cc` suffix is the ISO country code, which gives you a **country filter**. About 2,100 entries have no ID. |
| `tvg-logo` | Logo URL, sometimes empty. |
| `group-title` | Categories **joined with `;`** (e.g. `Kids;Music`). It's `Undefined` when there are none. The categories are Animation, Auto, Business, Classic, Comedy, Cooking, Culture, Documentary, Education, Entertainment, Family, General, Interactive, Kids, Legislative, Lifestyle, Movies, Music, News, Outdoor, Public, Relax, Religious, Science, Series, Shop, Sports, Travel, Weather and Undefined. |
| Title after the `,` | Channel name, then an optional `(quality)` such as `(1080p)`, then optional labels `[Geo-blocked]` or `[Not 24/7]`. Parse these out to get quality and status badges. |
| `http-referrer` / `http-user-agent` | Headers the stream **requires**. They appear both as attributes and as `#EXTVLCOPT` lines. About 330 entries need a referrer and about 1,150 need a custom user-agent. |
| URL line | About 96% are HLS (`.m3u8`), about 236 are DASH (`.mpd`) and a few are raw TS or HTTP. **About 20% use `http://`**, not `https://`. |

## Other ready-made playlists (same format, pre-filtered)

- `index.category.m3u`, `index.language.m3u`, `index.country.m3u`: everything, grouped differently through `group-title`
- `categories/<id>.m3u`, `languages/<code>.m3u`, `countries/<cc>.m3u`, `regions/<code>.m3u`
- `sources/<file>.m3u`, `raw/<file>.m3u`

## A structured alternative: the JSON API

`https://iptv-org.github.io/api/` has `channels.json`, `streams.json`, `feeds.json`, `logos.json`, `categories.json`, `languages.json`, `countries.json`, `regions.json`, `guides.json` and `blocklist.json`.

- `streams.json`: `{channel, feed, title, url, referrer, user_agent, quality, labels[]}`
- `channels.json`: `{id, name, alt_names, network, owners, country, categories[], is_nsfw, launched, closed, replaced_by, website}`

Joining `streams` to `channels` on `channel` gives richer filters (language, network, closed channels) without parsing M3U. **Recommendation:** support the M3U so the app works with any playlist URL, and optionally add the JSON for extra metadata.

## Things that will affect the app design

1. **Many streams are dead or flaky.** The list is community-maintained. Expect a real share to fail, with 1,221 marked Geo-blocked and 1,815 marked Not 24/7. The app needs quick failover and error messages, plus "try next stream for this channel". The same channel often has several URLs.
2. **Browser playback is limited. VLC has none of these limits:**
   - **CORS**: many stream servers don't send `Access-Control-Allow-Origin`, so `hls.js` in a web page can't fetch them.
   - **Mixed content**: about 20% `http://` streams are blocked on an `https://` page.
   - **Required headers**: browsers can't set a custom `User-Agent` or an arbitrary `Referer`.
   - A purely web app therefore needs a **proxy/relay server** to play many channels.
3. **Native players avoid all of the above**: Electron with mpv or libVLC, Android/Android TV with ExoPlayer (Media3), or iOS/tvOS with AVPlayer. Each can set headers per stream and has no CORS issue.
4. **Size**: ~18.7k entries is a few MB of text. Parse it once, cache it locally with a refresh about once a day, and use a virtualized list in the UI.

## Suggested core features

- Load and cache the playlist from a configurable URL. Default to the one above.
- Parse it into `{name, quality, labels, tvgId, country, categories[], logo, url, referrer, userAgent}`.
- Sort and filter by category, country, quality, status label and name search. Hide Geo-blocked if the user wants.
- Group duplicate URLs under one channel, with automatic fallback.
- Favorites and recently watched, stored locally.
- Optional later: an EPG from `x-tvg-url`, and stream health checks.
