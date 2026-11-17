import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseM3U, parseTitle } from '../src/shared/m3u.js'
import { groupEntries, countryFromTvgId } from '../src/shared/channels.js'

// Same shape as the entries iptv-org's generator writes (scripts/models/stream.ts toString).
const SAMPLE = [
  '#EXTM3U x-tvg-url="https://epg.example/guide1.xml.gz,https://epg.example/guide2.xml"',
  '#EXTINF:-1 tvg-id="France3.fr@NordPasdeCalaisHD" tvg-logo="https://logo.example/f3.png" http-referrer="https://ref.example/" http-user-agent="Mozilla/5.0 (X11, Linux)" group-title="General;News",France 3 Nord Pas-de-Calais (720p) [Geo-blocked]',
  '#EXTVLCOPT:http-referrer=https://ref.example/',
  '#EXTVLCOPT:http-user-agent=Mozilla/5.0 (X11, Linux)',
  'https://stream.example/f3/index.m3u8',
  '#EXTINF:-1 tvg-id="France3.fr@NordPasdeCalaisHD" tvg-logo="" group-title="News",France 3 Nord Pas-de-Calais (1080p)',
  'http://backup.example/f3.m3u8',
  '#EXTINF:-1 tvg-id="" tvg-logo="" group-title="Undefined",Some Local TV (Hamburg) [Not 24/7;Geo-blocked]',
  'https://local.example/live.m3u8',
  '#EXTINF:-1 tvg-id="KidsOne.us@SD" tvg-logo="https://logo.example/k.png" group-title="Kids",Kids, One (480p)',
  'https://kids.example/a.m3u8',
  '',
].join('\r\n')

test('parses header guide URLs', () => {
  const p = parseM3U(SAMPLE)
  assert.deepEqual(p.epgUrls, ['https://epg.example/guide1.xml.gz', 'https://epg.example/guide2.xml'])
  assert.equal(p.entries.length, 4)
})

test('parses attributes, title, quality, labels and VLC options', () => {
  const [e] = parseM3U(SAMPLE).entries
  assert.equal(e.name, 'France 3 Nord Pas-de-Calais')
  assert.equal(e.quality, '720p')
  assert.deepEqual(e.labels, ['Geo-blocked'])
  assert.equal(e.tvgId, 'France3.fr@NordPasdeCalaisHD')
  assert.equal(e.logo, 'https://logo.example/f3.png')
  assert.deepEqual(e.groups, ['General', 'News'])
  assert.equal(e.referrer, 'https://ref.example/')
  assert.equal(e.userAgent, 'Mozilla/5.0 (X11, Linux)')
  assert.equal(e.url, 'https://stream.example/f3/index.m3u8')
})

test('a comma inside a quoted attribute does not end the attributes', () => {
  const e = parseM3U(SAMPLE).entries[0]
  assert.equal(e.userAgent, 'Mozilla/5.0 (X11, Linux)')
})

test('keeps commas in the title and non-quality parentheses in the name', () => {
  const entries = parseM3U(SAMPLE).entries
  assert.equal(entries[3].name, 'Kids, One')
  assert.equal(entries[2].name, 'Some Local TV (Hamburg)')
  assert.equal(entries[2].quality, undefined)
  assert.deepEqual(entries[2].labels, ['Not 24/7', 'Geo-blocked'])
})

test('parseTitle handles bare names and 4K', () => {
  assert.deepEqual(parseTitle('Plain Name'), { name: 'Plain Name', quality: undefined, labels: [] })
  assert.equal(parseTitle('Nature (4K)').quality, '4K')
  assert.equal(parseTitle('News 24 (1080i) [Not 24/7]').quality, '1080i')
})

test('countryFromTvgId', () => {
  assert.equal(countryFromTvgId('France3.fr@HD'), 'fr')
  assert.equal(countryFromTvgId('BBCOne.uk'), 'uk')
  assert.equal(countryFromTvgId(undefined), undefined)
})

test('groups streams of the same channel and orders the healthiest first', () => {
  const channels = groupEntries(parseM3U(SAMPLE).entries)
  assert.equal(channels.length, 3)
  const f3 = channels.find(c => c.id === 'France3.fr@NordPasdeCalaisHD')!
  assert.equal(f3.streams.length, 2)
  // The unlabelled 1080p stream comes before the geo-blocked 720p one.
  assert.equal(f3.streams[0].url, 'http://backup.example/f3.m3u8')
  assert.deepEqual(f3.categories, ['General', 'News'])
  assert.equal(f3.country, 'fr')
  assert.equal(f3.logo, 'https://logo.example/f3.png')
  const local = channels.find(c => c.name === 'Some Local TV (Hamburg)')!
  assert.deepEqual(local.categories, ['Undefined'])
  assert.equal(local.country, undefined)
})
