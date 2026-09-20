import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { WebSocket } from 'ws'
import { PROTOCOL_VERSION } from '@remoteai/protocol'

const here = path.dirname(fileURLToPath(import.meta.url))

async function waitOk(url: string, ms = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('server did not start: ' + url)
}

test('signup login me host.hello', { timeout: 30000 }, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'remoteai-smoke-'))
  const port = 19000 + Math.floor(Math.random() * 2000)
  const tsx = path.resolve(here, '../../../node_modules/tsx/dist/cli.mjs')
  const child = spawn(process.execPath, [tsx, path.join(here, 'index.ts')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, XAI_API_KEY: '', PUBLIC_URL: '' },
    stdio: 'ignore',
    cwd: path.join(here, '..'),
  })
  t.after(async () => {
    child.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 300))
    child.kill('SIGKILL')
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  })
  await waitOk(`http://127.0.0.1:${port}/api/health`)

  const user = 'smoke' + Date.now().toString(36)
  const pass = 'pass1234'
  const signup = await fetch(`http://127.0.0.1:${port}/api/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
  })
  assert.equal(signup.status, 200)
  const signed = (await signup.json()) as { token: string }
  assert.ok(signed.token)

  const login = await fetch(`http://127.0.0.1:${port}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
  })
  assert.equal(login.status, 200)
  const logged = (await login.json()) as { token: string }
  const me = await fetch(`http://127.0.0.1:${port}/api/me`, {
    headers: { Authorization: 'Bearer ' + logged.token },
  })
  assert.equal(me.status, 200)
  const body = (await me.json()) as { username: string }
  assert.equal(body.username, user)

  const audit = await readFile(path.join(dir, 'audit.jsonl'), 'utf8')
  assert.match(audit, /signup\.ok/)
  assert.match(audit, /login\.ok/)

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
  await new Promise<void>((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('ws timeout')), 8000)
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'host.hello',
          protocol: PROTOCOL_VERSION,
          name: 'smoke-pc',
          os: 'test',
          displays: [],
          capabilities: {},
        }),
      )
    })
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as { type?: string; deviceId?: string }
      if (msg.type === 'host.welcome' && msg.deviceId) {
        clearTimeout(to)
        ws.close()
        resolve()
      }
    })
    ws.on('error', reject)
  })
})
