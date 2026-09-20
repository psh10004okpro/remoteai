import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hubLog, recentHubLogs, redactText } from './hub-log.js'

test('redact strips bearer and password-like fields', () => {
  assert.match(redactText('Authorization Bearer abc.def'), /Bearer \*\*\*/)
  assert.match(redactText('password=hunter2'), /password=\*\*\*/)
})

test('hubLog omits token fields and keeps event', () => {
  hubLog('error', 'ws.close', { token: 'secret', reason: 'host gone', deviceId: 'dev1' })
  const last = recentHubLogs(5).at(-1)
  assert.equal(last?.event, 'ws.close')
  assert.equal(last?.deviceId, 'dev1')
  assert.equal(last?.token, undefined)
})
