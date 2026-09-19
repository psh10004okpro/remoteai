import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  corsAllowOrigin,
  defaultAllowedOrigins,
  localApiOriginOk,
  rateLimited,
  resetRateLimits,
} from './security.js'

test('cors reflects only allowlisted origins', () => {
  const allowed = defaultAllowedOrigins(18790, 'https://hub.example')
  assert.equal(corsAllowOrigin('https://hub.example', allowed), 'https://hub.example')
  assert.equal(corsAllowOrigin('http://127.0.0.1:5173', allowed), 'http://127.0.0.1:5173')
  assert.equal(corsAllowOrigin('https://evil.example', allowed), undefined)
  assert.equal(corsAllowOrigin(undefined, allowed), undefined)
})

test('rate limit trips after max in window', () => {
  resetRateLimits()
  assert.equal(rateLimited('t:login', 3, 60_000), false)
  assert.equal(rateLimited('t:login', 3, 60_000), false)
  assert.equal(rateLimited('t:login', 3, 60_000), false)
  assert.equal(rateLimited('t:login', 3, 60_000), true)
  assert.equal(rateLimited('t:other', 3, 60_000), false)
})

test('local API origin allows loopback and hub, not random sites', () => {
  assert.equal(localApiOriginOk('', 'https://hub.example'), true)
  assert.equal(localApiOriginOk('http://127.0.0.1:5173', 'https://hub.example'), true)
  assert.equal(localApiOriginOk('https://hub.example', 'https://hub.example'), true)
  assert.equal(localApiOriginOk('https://evil.example', 'https://hub.example'), false)
})
