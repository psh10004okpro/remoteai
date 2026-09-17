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
  getUserRecord,
  issueSession,
  listDevicesForUser,
  loadStore,
  loginUser,
  logoutSession,
  newToken,
  renameDevice,
  saveUser,
  upsertDevice,
  userFromSession,
  verifyToken,
} from './store.js'
import { otpauth, randomSecret, totpOk } from './totp.js'
import { runAiTurn, type ToolBridge } from './ai.js'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

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
}

const rooms = new Map<string, Room>()
const PORT = Number(process.env.PORT || DEFAULT_PORT)
const webDist = path.resolve(here, '../../web/dist')

function publicBase() {
  const raw = (process.env.PUBLIC_URL || process.env.COOLIFY_URL || '').trim()
  if (raw) return raw.replace(/\/$/, '')
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
  const origin = req.headers.origin
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin)
  else res.setHeader('Access-Control-Allow-Origin', '*')
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
  const username = String(req.body?.username || '').trim()
  const password = String(req.body?.password || '')
  const made = createUser(username, password)
  if (!made.ok) {
    res.status(400).json({ error: made.error })
    return
  }
  const logged = loginUser(username, password)
  if (!logged.ok) {
    res.status(400).json({ error: logged.error })
    return
  }
  res.json({ token: logged.token, username: logged.username })
})

app.post('/api/login', (req, res) => {
  const username = String(req.body?.username || '').trim()
  const password = String(req.body?.password || '')
  const totp = String(req.body?.totp || '')
  const logged = loginUser(username, password)
  if (!logged.ok) {
    res.status(401).json({ error: logged.error })
    return
  }
  if (logged.totpRequired) {
    if (!totp) {
      res.json({ totpRequired: true, username: logged.username })
      return
    }
    const rec = getUserRecord(username)
    if (!rec?.totpSecret || !totpOk(rec.totpSecret, totp)) {
      res.status(401).json({ error: '인증 앱 코드가 올바르지 않습니다.', totpRequired: true })
      return
    }
    const token = issueSession(rec)
    res.json({ token, username: rec.username })
    return
  }
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

app.post('/api/2fa/setup', (req, res) => {
  const user = userFromSession(String(bearer(req) || ''))
  if (!user) {
    res.status(401).json({ error: '로그인이 필요합니다.' })
    return
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
  saveUser(user)
  res.json({ ok: true })
})

app.post('/api/2fa/disable', (req, res) => {
  const user = userFromSession(String(bearer(req) || ''))
  if (!user) {
    res.status(401).json({ error: '로그인이 필요합니다.' })
    return
  }
  if (user.totpEnabled && user.totpSecret && !totpOk(user.totpSecret, String(req.body?.code || ''))) {
    res.status(400).json({ error: '코드가 올바르지 않습니다.' })
    return
  }
  user.totpEnabled = false
  user.totpSecret = undefined
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

async function sendWol(mac: string) {
  const parts = mac.split(/[:\-]/).map((x) => parseInt(x, 16))
  if (parts.length !== 6 || parts.some((n) => Number.isNaN(n))) return { ok: false as const, error: 'bad mac' }
  const dgram = await import('node:dgram')
  const magic = Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(Buffer.from(parts))])
  await new Promise<void>((resolve, reject) => {
    const sock = dgram.createSocket('udp4')
    sock.bind(() => {
      sock.setBroadcast(true)
      sock.send(magic, 9, '255.255.255.255', (err) => {
        sock.close()
        if (err) reject(err)
        else resolve()
      })
    })
  })
  return { ok: true as const }
}

app.get('/api/wol/:mac', async (req, res) => {
  const r = await sendWol(req.params.mac)
  if (!r.ok) {
    res.status(400).json(r)
    return
  }
  res.json(r)
})

if (fs.existsSync(webDist)) {
  app.use(express.static(webDist))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next()
    res.sendFile(path.join(webDist, 'index.html'))
  })
}

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 * 1024 })

wss.on('connection', (ws) => {
  const client: Client = { ws, role: 'unknown' }

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
      send(ws, { type: 'host.error', message: err instanceof Error ? err.message : String(err) })
    }
  })

  ws.on('close', () => {
    if (client.role === 'host' && client.deviceId) {
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
        broadcastViewers(room, {
          type: 'ai.error',
          message: err instanceof Error ? err.message : String(err),
        })
      } finally {
        room.aiBusy = false
      }
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
})
