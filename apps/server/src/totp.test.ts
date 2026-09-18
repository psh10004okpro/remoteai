import assert from 'node:assert/strict'
import { test } from 'node:test'
import { otpauth, randomSecret, totp, totpOk } from './totp.js'
import { makeRecoveryCodes, recoveryHash } from './store.js'

test('totp accepts current window', () => {
  const secret = randomSecret()
  const code = totp(secret)
  assert.equal(code.length, 6)
  assert.equal(totpOk(secret, code), true)
  assert.equal(totpOk(secret, '000000'), false)
})

test('otpauth contains issuer and secret', () => {
  const secret = randomSecret()
  const url = otpauth('alice', secret)
  assert.match(url, /^otpauth:\/\/totp\/RemoteAI:/)
  assert.match(url, new RegExp(`secret=${secret}`))
  assert.match(url, /issuer=RemoteAI/)
})

test('recovery codes normalize dashes and case', () => {
  const codes = makeRecoveryCodes('bob')
  assert.equal(codes.length, 8)
  assert.match(codes[0], /^[a-z0-9]{4}-[a-z0-9]{4}$/)
  const a = recoveryHash('bob', codes[0])
  const b = recoveryHash('bob', codes[0].replace('-', '').toUpperCase())
  assert.equal(a, b)
  assert.notEqual(recoveryHash('bob', codes[0]), recoveryHash('bob', codes[1]))
})
