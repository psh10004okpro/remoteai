import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import express from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import {
  DEFAULT_PORT,
  DEFAULT_QUALITY,
  generateDeviceId,
  type Msg,
} from '@remoteai/protocol'
import {
  createUser,
  getDevice,
  hashToken,
  consumeRecovery,
  getUserRecord,
  issueSession,
  listDevicesForUser,
  makeRecoveryCodes,
  recoveryHash,
  loadStore,
  loginUser,
  logoutSession,
  newToken,
  renameDevice,
  deleteDevice,
  changePassword,
  saveUser,
  upsertDevice,
  userFromSession,
  verifyToken,
} from './store.js'
import { otpauth, randomSecret, totpOk } from './totp.js'
import { runAiTurn, type ToolBridge } from './ai.js'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { clientKey, corsAllowOrigin, defaultAllowedOrigins, rateLimited } from './security.js'
import { audit } from './audit.js'
import { hubLog } from './hub-log.js'
import { buildOpsReport, filterLogs } from './ops-report.js'

const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(here, '../../../.env') })
dotenv.config()

type Client = {
  ws: WebSocket
  role: 'host' | 'viewer' | 'unknown'
  deviceId?: string
  viewerId?: string
}

type Room = {
  host?: Client
  viewers: Map<string, Client>
  name: string
  displays: Msg extends { type: 'viewer.welcome'; displays: infer D } ? D : never
  capabilities: unknown
  quality: typeof DEFAULT_QUALITY
  aiBusy: boolean
  aiHistory: ChatCompletionMessageParam[]
  pendingTools: Map<string, (r: { ok: boolean; text?: string; imageJpegBase64?: string }) => void>
  oneTime?: { code: string; expiresAt: number }
  viewOnly: boolean
}

const rooms = new Map<string, Room>()
const PORT = Number(process.env.PORT || DEFAULT_PORT)
const startedAt = new Date().toISOString()
const webDist = path.resolve(here, '../../web/dist')
const dataRoot = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(here, '../data')

async function ensureReleaseAsset(name: string) {
  const cache = path.join(dataRoot, name)
  try {
    if (fs.existsSync(cache) && fs.statSync(cache).size > 1_000_000) return cache
  } catch {
    /* fetch */
  }
  const token = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim()
  const repo = (process.env.GITHUB_REPO || 'psh10004okpro/remoteai').replace(/^\/+|\/+$/g, '')
  if (!token) throw new Error('no github token')
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'remoteai-hub',
    Accept: 'application/vnd.github+json',
  }
  const rel = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers })
  if (!rel.ok) throw new Error('release ' + rel.status)
  const body = (await rel.json()) as { assets?: { name: string; url: string }[] }
  const asset = body.assets?.find((a) => a.name === name)
  if (!asset?.url) throw new Error('no asset ' + name)
  const bin = await fetch(asset.url, {
    headers: { ...headers, Accept: 'application/octet-stream' },
    redirect: 'follow',
  })
  if (!bin.ok) throw new Error('asset ' + bin.status)
  await fs.promises.mkdir(path.dirname(cache), { recursive: true })
  const tmp = cache + '.part'
  await fs.promises.writeFile(tmp, Buffer.from(await bin.arrayBuffer()))
  fs.renameSync(tmp, cache)
  return cache
}

function publicBase() {
  let raw = (process.env.PUBLIC_URL || process.env.COOLIFY_URL || '').trim()
  if (raw) {
    raw = raw.replace(/\/$/, '')
    if (raw.startsWith('http://') && !/localhost|127\.0\.0\.1/i.test(raw)) {
      raw = 'https://' + raw.slice('http://'.length)
    }
    return raw
  }
  const fqdn = (process.env.COOLIFY_FQDN || '').trim()
  if (fqdn) return `https://${fqdn.replace(/^https?:\/\//, '')}`
  return ''
}

function send(ws: WebSocket, msg: Msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function sendBin(ws: WebSocket, data: Buffer | Uint8Array) {
  if (ws.readyState === WebSocket.OPEN) ws.send(data)
}

function roomOf(deviceId: string): Room {
  let r = rooms.get(deviceId)
  if (!r) {
    r = {
      viewers: new Map(),
      name: 'PC',
      displays: [],
      capabilities: {},
      quality: { ...DEFAULT_QUALITY },
      aiBusy: false,
      aiHistory: [],
      pendingTools: new Map(),
      viewOnly: false,
    }
    rooms.set(deviceId, r)
  }
  return r
}

function broadcastViewers(room: Room, msg: Msg) {
  for (const v of room.viewers.values()) send(v.ws, msg)
}

function broadcastViewersBin(room: Room, data: Buffer | Uint8Array) {
  for (const v of room.viewers.values()) sendBin(v.ws, data)
}

function lanIps(): string[] {
  const out: string[] = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) out.push(n.address)
    }
  }
  return out
}

await loadStore()

const app = express()
app.use((req, res, next) => {
  const allowed = defaultAllowedOrigins(PORT, publicBase())
  const allow = corsAllowOrigin(req.headers.origin, allowed)
  if (allow) res.setHeader('Access-Control-Allow-Origin', allow)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  next()
})
app.set('trust proxy', 1)
app.use(express.json({ limit: '2mb' }))

function bearer(req: express.Request) {
  const h = req.headers.authorization || ''
  if (h.startsWith('Bearer ')) return h.slice(7)
  return (req.body && req.body.token) || req.query.token || ''
}

function iceServers() {
  const list: { urls: string; username?: string; credential?: string }[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ]
  const turn = (process.env.TURN_URL || '').trim()
  if (turn) {
    const cred = {
      username: process.env.TURN_USERNAME || undefined,
      credential: process.env.TURN_CREDENTIAL || undefined,
    }
    list.push({ urls: turn, ...cred })
    if (!/[?&]transport=/.test(turn)) {
      const base = turn.replace(/\?.*$/, '')
      list.push({ urls: `${base}?transport=udp`, ...cred })
      list.push({ urls: `${base}?transport=tcp`, ...cred })
    }
  }
  return list
}

app.get('/api/ice', (_req, res) => {
  res.json({ iceServers: iceServers() })
})

app.get('/api/health', (_req, res) => {
  const lan = lanIps()
  const pub = publicBase()
  res.json({
    ok: true,
    role: 'account-hub',
    version: PROTOCOL_VERSION_SAFE(),
    lan,
    port: PORT,
    publicUrl: pub || null,
    hostUrls: pub ? [pub] : lan.map((ip) => `http://${ip}:${PORT}`),
  })
})

app.post('/api/signup', (req, res) => {
  if (rateLimited(clientKey(req.ip || '', 'signup'), 8, 15 * 60_000)) {
    hubLog('warn', 'rate.signup', { ip: req.ip })
    res.status(429).json({ error: '잠시 후 다시 시도하세요.' })
    return
  }
  const username = String(req.body?.username || '').trim()
  const password = String(req.body?.password || '')
  const made = createUser(username, password)
  if (!made.ok) {
    audit('signup.fail', { username, ip: req.ip, reason: made.error })
    res.status(400).json({ error: made.error })
    return
  }
  const logged = loginUser(username, password)
  if (!logged.ok) {
    audit('signup.fail', { username, ip: req.ip, reason: logged.error })
    res.status(400).json({ error: logged.error })
    return
  }
  audit('signup.ok', { username, ip: req.ip })
  res.json({ token: logged.token, username: logged.username })
})

app.post('/api/login', (req, res) => {
  if (rateLimited(clientKey(req.ip || '', 'login'), 20, 15 * 60_000)) {
    hubLog('warn', 'rate.login', { ip: req.ip })
    res.status(429).json({ error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.' })
    return
  }
  const username = String(req.body?.username || '').trim()
  const password = String(req.body?.password || '')
  const totp = String(req.body?.totp || '')
  const logged = loginUser(username, password)
  if (!logged.ok) {
    audit('login.fail', { username, ip: req.ip })
    res.status(401).json({ error: logged.error })
    return
  }
  if (logged.totpRequired) {
    if (!totp) {
      res.json({ totpRequired: true, username: logged.username })
      return
    }
    const rec = getUserRecord(username)
    const totpGood = rec?.totpSecret && totpOk(rec.totpSecret, totp)
    const recGood = rec && consumeRecovery(rec, totp)
    if (!rec || (!totpGood && !recGood)) {
      audit('login.fail', { username, ip: req.ip, reason: 'totp' })
      res.status(401).json({ error: '인증 앱 코드 또는 복구 코드가 올바르지 않습니다.', totpRequired: true })
      return
    }
    const token = issueSession(rec)
    audit('login.ok', { username: rec.username, ip: req.ip })
    res.json({ token, username: rec.username })
    return
  }
  audit('login.ok', { username: logged.username, ip: req.ip })
  res.json({ token: logged.token, username: logged.username })
})

app.post('/api/logout', (req, res) => {
  const token = String(bearer(req) || '')
  if (token) logoutSession(token)
  res.json({ ok: true })
})

app.get('/api/me', (req, res) => {
  const user = userFromSession(String(bearer(req) || ''))
  if (!user) {
    res.status(401).json({ error: '로그인이 필요합니다.' })
    return
  }
  res.json({ username: user.username, totpEnabled: !!user.totpEnabled })
})

app.get('/api/ops/logs', (req, res) => {
  const user = userFromSession(String(bearer(req) || ''))
  if (!user) {
    res.status(401).json({ error: '로그인이 필요합니다.' })
    return
  }
  const limit = Number(req.query.limit || 200)
  const level = req.query.level === 'error' || req.query.level === 'warn' || req.query.level === 'info' ? req.query.level : undefined
  res.json({ logs: filterLogs(limit, level) })
})

app.get('/api/ops/report', (req, res) => {
  const user = userFromSession(String(bearer(req) || ''))
  if (!user) {
    res.status(401).json({ error: '로그인이 필요합니다.' })
    return
  }
  const list = listDevicesForUser(user.username).map((d) => ({
    id: d.id,
    name: d.name,
    online: !!rooms.get(d.id)?.host,
    lastSeen: d.lastSeen,
  }))
  const roomSnap = [...rooms.entries()]
    .filter(([id]) => list.some((d) => d.id === id))
    .map(([deviceId, r]) => ({
      deviceId,
      name: r.name,
      host: !!r.host,
      viewers: r.viewers.size,
      viewOnly: r.viewOnly,
    }))
  res.json(
    buildOpsReport({
      startedAt,
      version: PROTOCOL_VERSION_SAFE(),
      publicUrl: publicBase() || null,
      turn: !!(process.env.TURN_URL || '').trim(),
      xai: !!(process.env.XAI_API_KEY || '').trim(),
      rooms: roomSnap,
      devices: list,
      username: user.username,
    }),
  )
})

app.post('/api/ops/client', (req, res) => {
  const user = userFromSession(String(bearer(req) || ''))
  if (!user) {
    res.status(401).json({ error: '로그인이 필요합니다.' })
    return
  }
  if (rateLimited(clientKey(req.ip || '', 'opsclient'), 40, 60_000)) {
    res.status(429).json({ error: '잠시 후 다시 시도하세요.' })
    return
  }
  const level = req.body?.level === 'error' ? 'error' : req.body?.level === 'warn' ? 'warn' : 'info'
  hubLog(level, 'client', {
    username: user.username,
    page: String(req.body?.page || '').slice(0, 120),
    message: String(req.body?.message || '').slice(0, 500),
  })
  res.json({ ok: true })
})

app.post('/api/2fa/setup', (req, res) => {
  const user = userFromSession(String(bearer(req) || ''))
  if (!user) {
    res.status(401).json({ error: '로그인이 필요합니다.' })
    return
  }
  if (user.totpEnabled) {
    const code = String(req.body?.code || '')
    const totpGood = !!(user.totpSecret && totpOk(user.totpSecret, code))
    if (!totpGood && !consumeRecovery(user, code)) {
      res.status(400).json({ error: '이미 켜져 있습니다. 먼저 끄려면 인증 앱 코드 또는 복구 코드가 필요합니다.' })
      return
    }
    user.recoveryHashes = []
  }
  const secret = randomSecret()
  user.totpSecret = secret
  user.totpEnabled = false
  saveUser(user)
  res.json({ secret, otpauth: otpauth(user.username, secret) })
})

app.post('/api/2fa/enable', (req, res) => {
  const user = userFromSession(String(bearer(req) || ''))
  if (!user?.totpSecret) {
    res.status(400).json({ error: '먼저 설정을 시작하세요.' })
    return
  }
  if (!totpOk(user.totpSecret, String(req.body?.code || ''))) {
    res.status(400).json({ error: '코드가 올바르지 않습니다.' })
    return
  }
  user.totpEnabled = true
  const codes = makeRecoveryCodes(user.username)
  user.recoveryHashes = codes.map((c) => recoveryHash(user.username, c))
  saveUser(user)
  res.json({ ok: true, recoveryCodes: codes })
})

app.post('/api/2fa/disable', (req, res) => {
  const user = userFromSession(String(bearer(req) || ''))
  if (!user) {
    res.status(401).json({ error: '로그인이 필요합니다.' })
    return
  }
  const code = String(req.body?.code || '')
  if (user.totpEnabled) {
    const totpGood = !!(user.totpSecret && totpOk(user.totpSecret, code))
    if (!totpGood && !consumeRecovery(user, code)) {
      res.status(400).json({ error: '인증 앱 코드 또는 복구 코드가 올바르지 않습니다.' })
      return
    }
  }
  user.totpEnabled = false
  user.totpSecret = undefined
  user.recoveryHashes = []
  saveUser(user)
  res.json({ ok: true })
})

app.get('/api/devices', (req, res) => {
  const user = userFromSession(String(bearer(req) || ''))
  if (!user) {
    res.status(401).json({ error: '로그인이 필요합니다.' })
    return
  }
  const list = listDevicesForUser(user.username).map((d) => ({
    id: d.id,
    name: d.name,
    lastSeen: d.lastSeen,
    online: !!rooms.get(d.id)?.host,
    mac: d.mac || null,
  }))
  res.json({ devices: list })
})

app.post('/api/password', (req, res) => {
  const user = userFromSession(String(bearer(req) || ''))
  if (!user) {
    res.status(401).json({ error: '로그인이 필요합니다.' })
    return
  }
  if (rateLimited(clientKey(req.ip || '', 'password'), 8, 15 * 60_000)) {
    res.status(429).json({ error: '잠시 후 다시 시도하세요.' })
    return
  }
  const current = String(req.body?.current || '')
  const next = String(req.body?.next || '')
  const r = changePassword(user, current, next)
  if (!r.ok) {
    res.status(400).json({ error: r.error })
    return
  }
  audit('password.change', { username: user.username, ip: req.ip })
  res.json({ ok: true, token: r.token })
})

app.post('/api/devices/:id/delete', (req, res) => {
  const user = userFromSession(String(bearer(req) || ''))
  if (!user) {
    res.status(401).json({ error: '로그인이 필요합니다.' })
    return
  }
  const id = req.params.id
  const rec = getDevice(id)
  if (!rec || (rec.username || '').toLowerCase() !== user.username.toLowerCase()) {
    res.status(404).json({ error: '기기를 찾을 수 없습니다.' })
    return
  }
  const room = rooms.get(id)
  deleteDevice(id, user.username)
  audit('device.delete', { username: user.username, deviceId: id, ip: req.ip })
  if (room?.host) send(room.host.ws, { type: 'account.unlinked' })
  for (const v of room?.viewers.values() || []) {
    send(v.ws, { type: 'session.end', reason: '이 컴퓨터가 계정에서 제거되었습니다.' })
  }
  setTimeout(() => {
    try {
      room?.host?.ws.close()
    } catch {
      /* ignore */
    }
    for (const v of room?.viewers.values() || []) {
      try {
        v.ws.close()
      } catch {
        /* ignore */
      }
    }
    rooms.delete(id)
  }, 400)
  res.json({ ok: true })
})

app.post('/api/devices/:id/rename', (req, res) => {
  const user = userFromSession(String(bearer(req) || ''))
  if (!user) {
    res.status(401).json({ error: '로그인이 필요합니다.' })
    return
  }
  const name = String(req.body?.name || '').trim()
  if (!renameDevice(req.params.id, user.username, name)) {
    res.status(404).json({ error: '기기를 찾을 수 없습니다.' })
    return
  }
  res.json({ ok: true, name })
})

app.post('/api/devices/:id/wol', async (req, res) => {
  const user = userFromSession(String(bearer(req) || ''))
  if (!user) {
    res.status(401).json({ error: '로그인이 필요합니다.' })
    return
  }
  const d = getDevice(req.params.id)
  if (!d || (d.username || '').toLowerCase() !== user.username.toLowerCase() || !d.mac) {
    res.status(404).json({ error: 'MAC 주소가 없습니다.' })
    return
  }
  const helpers = listDevicesForUser(user.username).filter((x) => x.id !== d.id && rooms.get(x.id)?.host)
  const helper = helpers[0]
  if (!helper?.id) {
    res.status(409).json({ error: '같은 집에 켜져 있는 다른 컴퓨터가 필요합니다. (꺼진 PC는 허브가 아니라 그 PC가 깨웁니다.)' })
    return
  }
  const room = rooms.get(helper.id)
  if (!room?.host) {
    res.status(409).json({ error: '도와줄 호스트가 없습니다.' })
    return
  }
  send(room.host.ws, { type: 'wol.request', mac: d.mac })
  res.json({ ok: true, via: helper.name })
})

function PROTOCOL_VERSION_SAFE() {
  return 1
}

async function sendAsset(res: express.Response, name: string) {
  try {
    const cache = await ensureReleaseAsset(name)
    const st = fs.statSync(cache)
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
    res.setHeader('Content-Length', String(st.size))
    fs.createReadStream(cache).pipe(res)
  } catch {
    res.status(404).type('text/plain').send('설치 파일을 아직 준비하지 못했습니다.')
  }
}

app.get('/RemoteAI-Setup.exe', (_req, res) => {
  void sendAsset(res, 'RemoteAI-Setup.exe')
})
app.get('/RemoteAI-Mac.zip', (_req, res) => {
  void sendAsset(res, 'RemoteAI-Mac.zip')
})

if (fs.existsSync(webDist)) {
  app.use(express.static(webDist))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path === '/RemoteAI-Setup.exe' || req.path === '/RemoteAI-Mac.zip') return next()
    res.sendFile(path.join(webDist, 'index.html'))
  })
}

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 * 1024 })
const wsAlive = new WeakMap<WebSocket, boolean>()
setInterval(() => {
  for (const client of wss.clients) {
    if (wsAlive.get(client) === false) {
      hubLog('warn', 'ws.idle-timeout', {})
      client.terminate()
      continue
    }
    wsAlive.set(client, false)
    try {
      client.ping()
    } catch {
      /* ignore */
    }
  }
}, 20000).unref()

wss.on('connection', (ws) => {
  const client: Client = { ws, role: 'unknown' }
  wsAlive.set(ws, true)
  ws.on('pong', () => wsAlive.set(ws, true))

  ws.on('message', async (data, isBinary) => {
    if (isBinary) {
      if (client.role === 'host' && client.deviceId) {
        const room = rooms.get(client.deviceId)
        if (room) broadcastViewersBin(room, data as Buffer)
      } else if (client.role === 'viewer' && client.deviceId) {
        const room = rooms.get(client.deviceId)
        if (room?.host) sendBin(room.host.ws, data as Buffer)
      }
      return
    }
    let msg: Msg
    try {
      msg = JSON.parse(String(data)) as Msg
    } catch {
      return
    }
    try {
      await handleJson(client, msg)
    } catch (err) {
      hubLog('error', 'ws.handler', {
        role: client.role,
        deviceId: client.deviceId,
        message: err instanceof Error ? err.message : String(err),
      })
      send(ws, { type: 'host.error', message: err instanceof Error ? err.message : String(err) })
    }
  })

  ws.on('close', () => {
    if (client.role === 'host' && client.deviceId) {
      hubLog('warn', 'ws.host.close', { deviceId: client.deviceId })
      const room = rooms.get(client.deviceId)
      if (room && room.host === client) {
        room.host = undefined
        broadcastViewers(room, { type: 'session.end', reason: '호스트가 연결을 끊었습니다.' })
      }
    }
    if (client.role === 'viewer' && client.deviceId && client.viewerId) {
      const room = rooms.get(client.deviceId)
      room?.viewers.delete(client.viewerId)
      if (room?.host) {
        send(room.host.ws, { type: 'chat', from: 'system', text: '뷰어가 나갔습니다.' })
        send(room.host.ws, { type: 'viewer.count', n: room.viewers.size })
      }
    }
  })
})

async function handleJson(client: Client, msg: Msg) {
  switch (msg.type) {
    case 'host.hello': {
      let id = msg.deviceId
      let token = msg.token
      const account = userFromSession(msg.accountToken)
      if (id && token && verifyToken(id, token)) {
        const rec = getDevice(id)!
        upsertDevice({
          ...rec,
          name: rec.nameIsCustom ? rec.name : msg.name,
          lastSeen: Date.now(),
          mac: msg.mac,
          username: account?.username || rec.username,
        })
      } else {
        id = generateDeviceId()
        token = newToken()
        upsertDevice({
          id,
          tokenHash: hashToken(id, token),
          name: msg.name,
          lastSeen: Date.now(),
          mac: msg.mac,
          username: account?.username,
        })
      }
      const prev = rooms.get(id)
      if (prev?.host && prev.host.ws !== client.ws) {
        try {
          prev.host.ws.close()
        } catch {
          /* ignore */
        }
      }
      client.role = 'host'
      client.deviceId = id
      const room = roomOf(id)
      room.host = client
      room.name = msg.name
      room.displays = msg.displays
      room.capabilities = msg.capabilities
      send(client.ws, { type: 'host.welcome', deviceId: id, token: token!, accountUser: account?.username })
      broadcastViewers(room, { type: 'display.list', displays: msg.displays })
      return
    }
    case 'viewer.auth': {
      const room = rooms.get(msg.deviceId)
      if (!room?.host) {
        send(client.ws, { type: 'viewer.denied', message: '이 컴퓨터가 온라인이 아닙니다.' })
        return
      }
      const account = userFromSession(msg.accountToken)
      const device = getDevice(msg.deviceId)
      if (account && device && device.username && device.username.toLowerCase() === account.username.toLowerCase()) {
        admitViewer(client, msg.deviceId, room)
        return
      }
      if (!msg.password) {
        send(client.ws, { type: 'viewer.denied', message: '로그인이 필요하거나 비밀번호가 없습니다.' })
        return
      }
      client.role = 'viewer'
      client.deviceId = msg.deviceId
      client.viewerId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
      send(room.host.ws, { type: 'viewer.auth', deviceId: msg.deviceId, password: msg.password })
      const viewerId = client.viewerId
      setTimeout(() => {
        if (client.role === 'viewer' && !room.viewers.has(viewerId)) {
          send(client.ws, { type: 'viewer.denied', message: '비밀번호가 틀리거나 호스트가 응답하지 않습니다.' })
        }
      }, 8000)
      pendingViewer.set(msg.deviceId + ':auth', client)
      return
    }
    case 'viewer.authCode': {
      const found = [...rooms.entries()].find(([, r]) => r.oneTime && r.oneTime.code === msg.code && r.oneTime.expiresAt > Date.now())
      if (!found) {
        send(client.ws, { type: 'viewer.denied', message: '일회용 코드가 유효하지 않습니다.' })
        return
      }
      const [deviceId, room] = found
      if (!room.host) {
        send(client.ws, { type: 'viewer.denied', message: '호스트가 오프라인입니다.' })
        return
      }
      admitViewer(client, deviceId, room)
      return
    }
    case 'viewer.welcome': {
      // host accepted password — attach waiting viewer
      if (client.role !== 'host' || !client.deviceId) return
      const waiting = pendingViewer.get(client.deviceId + ':auth')
      pendingViewer.delete(client.deviceId + ':auth')
      const room = roomOf(client.deviceId)
      if (waiting) admitViewer(waiting, client.deviceId, room)
      return
    }
    case 'viewer.denied': {
      if (client.role !== 'host' || !client.deviceId) return
      const waiting = pendingViewer.get(client.deviceId + ':auth')
      pendingViewer.delete(client.deviceId + ':auth')
      if (waiting) send(waiting.ws, msg)
      return
    }
    case 'ai.user': {
      if (client.role !== 'viewer' || !client.deviceId) return
      const room = rooms.get(client.deviceId)
      if (!room?.host) return
      if (room.viewOnly) {
        send(client.ws, { type: 'ai.error', message: '보기 전용이라 AI로 조작할 수 없습니다.' })
        return
      }
      if (room.aiBusy) {
        send(client.ws, { type: 'ai.status', text: '이전 요청을 처리 중입니다.' })
        return
      }
      room.aiBusy = true
      const hostWs = room.host.ws
      const bridge: ToolBridge = {
        status(text) {
          broadcastViewers(room, { type: 'ai.status', text })
        },
        call(name, args) {
          return new Promise((resolve) => {
            const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
            room.pendingTools.set(id, resolve)
            send(hostWs, { type: 'ai.tool', id, name, args })
            setTimeout(() => {
              if (room.pendingTools.has(id)) {
                room.pendingTools.delete(id)
                resolve({ ok: false, text: '도구 시간 초과' })
              }
            }, 60_000)
          })
        },
      }
      try {
        const text = await runAiTurn(msg.text, room.aiHistory, bridge)
        room.aiHistory.push({ role: 'user', content: msg.text }, { role: 'assistant', content: text })
        broadcastViewers(room, { type: 'ai.assistant', text })
      } catch (err) {
        hubLog('error', 'ai.turn', { deviceId: client.deviceId, message: err instanceof Error ? err.message : String(err) })
        broadcastViewers(room, {
          type: 'ai.error',
          message: err instanceof Error ? err.message : String(err),
        })
      } finally {
        room.aiBusy = false
      }
      return
    }
    case 'session.viewOnly': {
      if (client.role !== 'viewer' || !client.deviceId) return
      const room = rooms.get(client.deviceId)
      if (room) room.viewOnly = !!msg.on
      if (room?.host) send(room.host.ws, msg)
      return
    }
    case 'ai.toolResult': {
      if (client.role !== 'host' || !client.deviceId) return
      const room = rooms.get(client.deviceId)
      const pending = room?.pendingTools.get(msg.id)
      if (pending) {
        room!.pendingTools.delete(msg.id)
        pending({ ok: msg.ok, text: msg.text, imageJpegBase64: msg.imageJpegBase64 })
      }
      return
    }
    case 'oneTime.create': {
      if (client.role !== 'host' || !client.deviceId) return
      const room = roomOf(client.deviceId)
      const code = String(Math.floor(100_000 + Math.random() * 900_000))
      room.oneTime = { code, expiresAt: Date.now() + 15 * 60 * 1000 }
      send(client.ws, { type: 'oneTime.code', code, expiresAt: room.oneTime.expiresAt })
      return
    }
    default: {
      if (client.role === 'host' && client.deviceId) {
        const room = rooms.get(client.deviceId)
        if (room) broadcastViewers(room, msg)
      } else if (client.role === 'viewer' && client.deviceId) {
        const room = rooms.get(client.deviceId)
        if (room?.host) send(room.host.ws, msg)
      }
    }
  }
}

const pendingViewer = new Map<string, Client>()

function admitViewer(client: Client, deviceId: string, room: Room) {
  client.role = 'viewer'
  client.deviceId = deviceId
  client.viewerId = client.viewerId || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  room.viewers.set(client.viewerId, client)
  send(client.ws, {
    type: 'viewer.welcome',
    deviceId,
    name: room.name,
    displays: room.displays,
    capabilities: room.capabilities as never,
    quality: room.quality,
  })
  if (room.host) {
    send(room.host.ws, { type: 'chat', from: 'system', text: '뷰어가 접속했습니다.' })
    send(room.host.ws, { type: 'viewer.count', n: room.viewers.size })
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[remoteai-server] http://127.0.0.1:${PORT}`)
  const pub = publicBase()
  if (pub) console.log(`[remoteai-server] public ${pub}`)
  for (const ip of lanIps()) console.log(`[remoteai-server] http://${ip}:${PORT}`)
  hubLog('info', 'hub.start', { port: PORT, publicUrl: pub || null })
})
