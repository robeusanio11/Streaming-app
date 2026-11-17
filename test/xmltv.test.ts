import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseXmltv, parseXmltvDate, decodeEntities } from '../src/server/xmltv.js'
import { normalizeName } from '../src/server/epg.js'
import { programmeAt, upcoming } from '../src/shared/epg.js'

const XML = `<?xml version="1.0" encoding="UTF-8"?><tv>
  <channel id="abc123">
    <display-name>Pluto TV Action</display-name>
    <icon src="https://img.example/a.png"/>
  </channel>
  <programme channel="abc123" start="20261117030000 +0000" stop="20261117040000 +0000">
    <title>Rocky &amp; Friends</title>
    <sub-title><![CDATA[Part <1>]]></sub-title>
    <desc>A boxer&#39;s story.</desc>
    <category>Movies</category><category>Action</category><category>Movies</category>
    <episode-num system="onscreen">S01E02</episode-num>
    <icon src="https://img.example/p.jpg?a=1&amp;b=2"/>
  </programme>
  <programme channel="abc123" start="20261117040000 +0100" stop="20261117050000 +0100">
    <title>Early</title>
  </programme>
  <programme channel="abc123" start="20261118120000 +0000" stop="20261118130000 +0000">
    <title>Outside window</title>
  </programme>
</tv>`

test('parseXmltvDate handles offsets', () => {
  assert.equal(parseXmltvDate('20261117030000 +0000'), Date.UTC(2026, 10, 17, 3))
  assert.equal(parseXmltvDate('20261117040000 +0100'), Date.UTC(2026, 10, 17, 3))
  assert.equal(parseXmltvDate('20261117030000 -0500'), Date.UTC(2026, 10, 17, 8))
  assert.equal(parseXmltvDate('20261117030000'), Date.UTC(2026, 10, 17, 3))
  assert.ok(Number.isNaN(parseXmltvDate('garbage')))
})

test('decodeEntities', () => {
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &#39;d&#x27; &quot;'), `a & b <c> 'd' "`)
})

test('parseXmltv reads channels and programmes inside the window', () => {
  const from = Date.UTC(2026, 10, 17, 0)
  const parsed = parseXmltv(XML, { from, to: from + 24 * 3600_000 })
  assert.deepEqual(parsed.channels, [{ id: 'abc123', names: ['Pluto TV Action'], icon: 'https://img.example/a.png' }])
  const list = parsed.programmes.get('abc123')!
  assert.equal(list.length, 2) // the one outside the window is dropped
  const p = list[0]
  assert.equal(p.title, 'Rocky & Friends')
  assert.equal(p.subtitle, 'Part <1>')
  assert.equal(p.description, "A boxer's story.")
  assert.deepEqual(p.categories, ['Movies', 'Action'])
  assert.equal(p.episode, 'S01E02')
  assert.equal(p.icon, 'https://img.example/p.jpg?a=1&b=2')
  // "04:00 +0100" is 03:00 UTC, the same start as the first one. Sorting must be stable by start.
  assert.equal(list[1].start, Date.UTC(2026, 10, 17, 3))
})

test('programmeAt and upcoming', () => {
  const list = [
    { start: 0, stop: 10, title: 'a' },
    { start: 10, stop: 20, title: 'b' },
    { start: 20, stop: 30, title: 'c' },
  ]
  assert.equal(programmeAt(list, 15)?.title, 'b')
  assert.equal(programmeAt(list, 30), undefined)
  assert.deepEqual(upcoming(list, 15, 2).map(p => p.title), ['b', 'c'])
})

test('normalizeName ignores case, accents, punctuation and HD/TV suffixes', () => {
  assert.equal(normalizeName('Télé-Québec HD'), normalizeName('tele quebec'))
  assert.equal(normalizeName('CBS News 24/7'), 'cbsnews247')
})

test('normalizeName drops bracketed regions', () => {
  assert.equal(normalizeName('ESPN (United States) HD'), normalizeName('ESPN HD'))
  assert.equal(normalizeName('ESPN 2 (United States) HD'), normalizeName('ESPN2 HD'))
  assert.equal(normalizeName('Fox News [Geo-blocked]'), 'foxnews')
})
