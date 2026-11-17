import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { createApp } from '../src/server/index.js'
import { mergeLibraries } from '../src/shared/account.js'

let server: Server
let base = ''
let dataDir = ''

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'streaming-accounts-'))
  server = createApp({ dataDir }).listen(0, '127.0.0.1')
  await new Promise(r => server.once('listening', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(async () => {
  server.close()
  await fs.rm(dataDir, { recursive: true, force: true })
})

/** A tiny cookie-keeping client, like one browser. */
function browser() {
  let cookie = ''
  return async (method: string, url: string, body?: unknown, contentType = 'application/json') => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': contentType, ...(cookie ? { Cookie: cookie } : {}) },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    })
    const set = res.headers.get('set-cookie')
    if (set) cookie = /Max-Age=0/.test(set) ? '' : set.split(';')[0]
    return { status: res.status, body: (await res.json()) as any, setCookie: set }
  }
}

test('create an account, save channels, and read them back from another browser', async () => {
  const a = browser()
  const reg = await a('POST', '/api/auth/register', { username: 'Robert', password: 'correct horse' })
  assert.equal(reg.status, 201)
  assert.equal(reg.body.user.username, 'robert')
  assert.match(reg.setCookie!, /HttpOnly/)
  assert.match(reg.setCookie!, /SameSite=Lax/)

  const put = await a('PUT', '/api/library', { favorites: ['ESPN.us@HD', 'ESPN.us@HD', 'CNN.us@SD'], recent: ['CNN.us@SD'] })
  assert.equal(put.status, 200)
  assert.deepEqual(put.body.library.favorites, ['ESPN.us@HD', 'CNN.us@SD'], 'duplicates are dropped')

  const b = browser()
  assert.equal((await b('GET', '/api/auth/me')).body.user, null)
  const login = await b('POST', '/api/auth/login', { username: 'robert', password: 'correct horse' })
  assert.equal(login.status, 200)
  assert.deepEqual(login.body.library, { favorites: ['ESPN.us@HD', 'CNN.us@SD'], recent: ['CNN.us@SD'] })

  const out = await b('POST', '/api/auth/logout')
  assert.equal(out.status, 200)
  assert.equal((await b('GET', '/api/auth/me')).body.user, null)
  assert.equal((await b('PUT', '/api/library', { favorites: [] })).status, 401)
  // The first browser is still signed in.
  assert.equal((await a('GET', '/api/auth/me')).body.user.username, 'robert')
})

test('wrong passwords, taken usernames and weak passwords are refused', async () => {
  const c = browser()
  assert.equal((await c('POST', '/api/auth/register', { username: 'dana', password: 'longenough' })).status, 201)
  assert.equal((await c('POST', '/api/auth/register', { username: 'DANA', password: 'longenough' })).status, 409)
  assert.equal((await c('POST', '/api/auth/register', { username: 'ed', password: 'longenough' })).status, 400)
  assert.equal((await c('POST', '/api/auth/register', { username: 'eddie', password: 'short' })).status, 400)
  const bad = await browser()('POST', '/api/auth/login', { username: 'dana', password: 'nope-nope' })
  assert.equal(bad.status, 401)
  assert.equal(bad.body.error, 'Wrong username or password.')
  const missing = await browser()('POST', '/api/auth/login', { username: 'nobody', password: 'nope-nope' })
  assert.equal(missing.body.error, bad.body.error, 'unknown usernames get the same answer')
})

test('sign-in is locked for a while after 10 wrong passwords', async () => {
  await browser()('POST', '/api/auth/register', { username: 'frank', password: 'right-password' })
  const d = browser()
  for (let i = 0; i < 10; i++) await d('POST', '/api/auth/login', { username: 'frank', password: 'wrong-password' })
  const locked = await d('POST', '/api/auth/login', { username: 'frank', password: 'right-password' })
  assert.equal(locked.status, 429)
})

test('changes sent as a plain form are refused', async () => {
  const e = browser()
  const res = await e('POST', '/api/auth/register', { username: 'gina', password: 'longenough' }, 'application/x-www-form-urlencoded')
  assert.equal(res.status, 415)
})

test('deleting an account needs the password and removes the account', async () => {
  const f = browser()
  await f('POST', '/api/auth/register', { username: 'hana', password: 'longenough' })
  assert.equal((await f('DELETE', '/api/auth/account', { password: 'wrong-one' })).status, 403)
  assert.equal((await f('DELETE', '/api/auth/account', { password: 'longenough' })).status, 200)
  assert.equal((await f('GET', '/api/auth/me')).body.user, null)
  assert.equal((await browser()('POST', '/api/auth/login', { username: 'hana', password: 'longenough' })).status, 401)
})

test('accounts survive a server restart and passwords are not stored in plain text', async () => {
  const file = await fs.readFile(path.join(dataDir, 'accounts.json'), 'utf8')
  assert.ok(!file.includes('correct horse'))
  assert.match(file, /scrypt\$/)
  const restarted = createApp({ dataDir }).listen(0, '127.0.0.1')
  await new Promise(r => restarted.once('listening', r))
  const url = `http://127.0.0.1:${(restarted.address() as AddressInfo).port}`
  const res = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'robert', password: 'correct horse' }),
  })
  restarted.close()
  assert.equal(res.status, 200)
  assert.deepEqual(((await res.json()) as any).library.favorites, ['ESPN.us@HD', 'CNN.us@SD'])
})

test('mergeLibraries keeps account entries first and adds device-only ones', () => {
  const merged = mergeLibraries({ favorites: ['a', 'b'], recent: ['x'] }, { favorites: ['b', 'c'], recent: ['y', 'x'] })
  assert.deepEqual(merged, { favorites: ['a', 'b', 'c'], recent: ['x', 'y'] })
})
