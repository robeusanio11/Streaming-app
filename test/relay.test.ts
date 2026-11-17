import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rewriteManifest } from '../src/server/proxy.js'
import { isPrivateAddress } from '../src/server/net.js'

const master = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
low/index.m3u8
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="en",URI="audio/en.m3u8"
#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example/k1"
#EXT-X-MAP:URI="init.mp4"
https://cdn.example/abs/seg1.ts
`

test('rewriteManifest sends every URI through the relay with the headers', () => {
  const out = rewriteManifest(master, 'https://origin.example/live/master.m3u8', {
    referrer: 'https://ref.example/',
    userAgent: 'UA/1',
  })
  const lines = out.split('\n')
  const decode = (s: string) => new URLSearchParams(s.slice(s.indexOf('?') + 1))

  const variant = decode(lines[2])
  assert.equal(variant.get('url'), 'https://origin.example/live/low/index.m3u8')
  assert.equal(variant.get('ref'), 'https://ref.example/')
  assert.equal(variant.get('ua'), 'UA/1')

  const uri = (line: string) => decode(/URI="([^"]+)"/.exec(line)![1].replace(/&amp;/g, '&')).get('url')
  assert.equal(uri(lines[3]), 'https://origin.example/live/audio/en.m3u8')
  assert.equal(uri(lines[4]), 'https://keys.example/k1')
  assert.equal(uri(lines[5]), 'https://origin.example/live/init.mp4')
  assert.equal(decode(lines[6]).get('url'), 'https://cdn.example/abs/seg1.ts')
  assert.equal(lines[1], '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360')
})

test('isPrivateAddress blocks internal ranges and allows public ones', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1', '0.0.0.0']) {
    assert.equal(isPrivateAddress(ip), true, ip)
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111', '172.32.0.1']) {
    assert.equal(isPrivateAddress(ip), false, ip)
  }
})
