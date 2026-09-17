import os from 'node:os'
import { exec } from 'node:child_process'
import WebSocket from 'ws'
import {
  DEFAULT_CAPABILITIES,
  DEFAULT_QUALITY,
  FILE_CHUNK_SIZE,
  MAX_AUTO_CLIPBOARD_BYTES,
  decodeFileChunk,
  encodeFileChunk,
  encodePty,
  formatDeviceId,
  type Msg,
  type QualitySettings,
} from '@remoteai/protocol'
import { loadConfig, saveConfig } from './config.js'
import { log } from './log.js'
import { captureFrame, listDisplays } from './capture.js'
import { handleKey, handleMouse, handleSpecial, handleText } from './input.js'
import {
  clipboardChanged,
  getClipboard,
  initClipboardSeq,
  setClipboardFiles,
  setClipboardText,
} from './clipboard.js'
import { abortIncoming, beginIncoming, completeBatch, endIncoming, flattenPaths, listPath, writeIncoming } from './files.js'
import { isAutoStart, setAutoStart } from './autostart.js'
import { setBlankScreen } from './privacy.js'
import { closeTerminal, openTerminal, resizeTerminal, writeTerminal } from './terminal.js'
import { startSsh } from './ssh.js'
import { runTool } from './ai-tools.js'
import { startLocalApi } from './local-api.js'
import { primaryMac, wsUrlFromHttp } from './net.js'
import { startTray } from './tray.js'
import { notify } from './notify.js'
import { startAudio, stopAudio } from './audio.js'
import { createReadStream } from 'node:fs'

let cfg = loadConfig()
cfg.autoStart = isAutoStart() || cfg.autoStart
let deviceId = cfg.deviceId || ''
let online = false
let viewers = 0
let displayId = 0
let quality: QualitySettings = { ...DEFAULT_QUALITY }
let capturing = false
let viewOnly = false
let autoQuality = true

let ws: WebSocket | null = null
let nextTransfer = 1
let lastOneTime: { code: string; expiresAt: number } | null = null
const silent = process.argv.includes('--silent')

function send(msg: Msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function sendBin(data: Uint8Array) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(data)
}

function openUi() {
  const url = 'http://127.0.0.1:5173/#/'
  exec(`cmd /c start "" "${url}"`)
}

startLocalApi({
  cfg: () => cfg,
  save: (patch) => {
    const needReconnect =
      (patch.accountToken !== undefined && patch.accountToken !== cfg.accountToken) ||
      (patch.serverUrl !== undefined && patch.serverUrl !== cfg.serverUrl)
    cfg = { ...cfg, ...patch }
    saveConfig(cfg)
    if (patch.autoStart != null || patch.serverUrl != null) setAutoStart(cfg.autoStart)
    if (patch.sshLan != null || patch.password) {
      try {
        startSsh({ password: cfg.password, lan: cfg.sshLan })
      } catch (e) {
        log('ssh restart failed', e)
      }
    }
    if (needReconnect) reconnectNow()
  },
  online: () => online,
  deviceId: () => deviceId,
  displays: () => listDisplays(),
  oneTime: () => {
    send({ type: 'oneTime.create' })
  },
  lastOneTime: () => lastOneTime,
  login: async (username, password) => {
    try {
      const r = await fetch(cfg.serverUrl.replace(/\/$/, '') + '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const body = (await r.json()) as { token?: string; username?: string; error?: string }
      if (!r.ok || !body.token) return { ok: false, error: body.error || '로그인 실패' }
      cfg = { ...cfg, accountUser: body.username, accountToken: body.token }
      saveConfig(cfg)
      reconnectNow()
      return { ok: true, username: body.username }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },
  logout: () => {
    cfg = { ...cfg, accountUser: undefined, accountToken: undefined }
    saveConfig(cfg)
    reconnectNow()
  },
})

if (cfg.autoStart) setAutoStart(true)
try {
  startSsh({ password: cfg.password, lan: cfg.sshLan })
} catch (e) {
  log('ssh start failed', e)
}
initClipboardSeq()
void startTray({ deviceId: () => deviceId, password: () => cfg.password, openUi })

async function captureLoop() {
  if (capturing) return
  capturing = true
  while (viewers > 0) {
    const t0 = Date.now()
    try {
      if (autoQuality) {
        if (ws && ws.bufferedAmount > 800_000) quality = { ...quality, fps: 6, jpegQuality: 40 }
        else quality = { ...quality, fps: 12, jpegQuality: 55 }
      }
      if (ws && ws.bufferedAmount < 2_000_000) {
        const frame = await captureFrame(displayId, quality)
        if (frame) sendBin(frame)
      }
    } catch (e) {
      log('capture', e)
    }
    const wait = Math.max(10, 1000 / quality.fps - (Date.now() - t0))
    await new Promise((r) => setTimeout(r, wait))
  }
  capturing = false
}

setInterval(() => {
  if (viewers === 0 || !online) return
  if (!clipboardChanged()) return
  const clip = getClipboard()
  if (clip.kind === 'text' && clip.text != null) {
    send({ type: 'clipboard.text', text: clip.text, origin: 'host' })
  } else if (clip.files.length) {
    void sendFileBatch(clip.files, 'clipboard')
  }
}, 400)

async function sendFileBatch(paths: string[], reason: string) {
  const files = await flattenPaths(paths)
  if (!files.length) return
  const total = files.reduce((n, f) => n + f.size, 0)
  if (total > MAX_AUTO_CLIPBOARD_BYTES) {
    send({ type: 'chat', from: 'system', text: `클립보드 파일이 50MB를 넘어 전송을 건너뜁니다 (${reason}).` })
    return
  }
  const batchId = `${Date.now()}-${nextTransfer}`
  send({
    type: 'clipboard.files.offer',
    origin: 'host',
    batchId,
    files: files.map(({ name, size, relativePath }) => ({ name, size, relativePath })),
  })
  for (const f of files) {
    const id = nextTransfer++
    send({
      type: 'file.start',
      transferId: id,
      name: f.name,
      size: f.size,
      relativePath: f.relativePath,
      origin: 'host',
      batchId,
    })
    await streamFile(id, f.full, batchId)
  }
  send({ type: 'clipboard.files.complete', origin: 'host', batchId })
}

async function streamFile(transferId: number, filePath: string, batchId?: string) {
  const stream = createReadStream(filePath, { highWaterMark: FILE_CHUNK_SIZE })
  let seq = 0
  for await (const chunk of stream) {
    const buf = chunk as Buffer
    sendBin(encodeFileChunk(transferId, seq++, false, buf))
  }
  sendBin(encodeFileChunk(transferId, seq, true, new Uint8Array()))
  send({ type: 'file.end', transferId, savedPath: filePath, batchId, origin: 'host' })
}

async function handle(msg: Msg) {
  switch (msg.type) {
    case 'host.welcome':
      deviceId = msg.deviceId
      cfg.deviceId = msg.deviceId
      cfg.token = msg.token
      if (msg.accountUser) cfg.accountUser = msg.accountUser
      saveConfig(cfg)
      log('registered', formatDeviceId(deviceId), cfg.accountUser || 'no-account')
      break
    case 'viewer.auth': {
      const ok = msg.password === cfg.password
      if (ok) {
        send({
          type: 'viewer.welcome',
          deviceId,
          name: os.hostname(),
          displays: listDisplays(),
          capabilities: DEFAULT_CAPABILITIES,
          quality,
        })
      } else {
        send({ type: 'viewer.denied', message: '비밀번호가 올바르지 않습니다.' })
      }
      break
    }
    case 'viewer.count':
      viewers = msg.n
      if (viewers > 0) {
        void captureLoop()
        notify('RemoteAI', '원격 접속이 시작되었습니다.')
      }
      if (viewers === 0 && cfg.lockOnDisconnect) handleSpecial('lock')
      break
    case 'input.mouse':
      if (!viewOnly) handleMouse(msg)
      break
    case 'input.key':
      if (!viewOnly) handleKey(msg.code, msg.action === 'down')
      break
    case 'input.text':
      if (!viewOnly) handleText(msg.text)
      break
    case 'input.special':
      if (!viewOnly) handleSpecial(msg.key)
      break
    case 'display.select':
      displayId = msg.displayId
      break
    case 'quality.set':
      quality = { ...quality, ...msg.quality }
      autoQuality = false
      break
    case 'session.viewOnly':
      viewOnly = msg.on
      break
    case 'session.fit':
      quality = { ...quality, maxWidth: Math.max(640, Math.min(1920, Math.round(msg.width))) }
      break
    case 'ping':
      send({ type: 'pong', t: msg.t })
      break
    case 'audio.toggle':
      if (msg.on) startAudio(sendBin)
      else stopAudio()
      break
    case 'clipboard.text':
      if (msg.origin === 'viewer') setClipboardText(msg.text)
      break
    case 'clipboard.files.accept':
      break
    case 'file.list': {
      try {
        const r = await listPath(msg.path)
        send({ type: 'file.listResult', path: r.path, entries: r.entries })
      } catch (e) {
        send({ type: 'file.listResult', path: msg.path, entries: [], error: e instanceof Error ? e.message : String(e) })
      }
      break
    }
    case 'file.start':
      if (msg.origin === 'viewer') beginIncoming(msg.transferId, msg.relativePath, msg.toPath, msg.batchId)
      break
    case 'file.end':
      if (msg.origin === 'viewer') {
        const saved = await endIncoming(msg.transferId)
        send({ type: 'file.end', transferId: msg.transferId, savedPath: saved || undefined, origin: 'host' })
      }
      break
    case 'clipboard.files.complete':
      if (msg.origin === 'viewer') completeBatch(msg.batchId)
      break
    case 'file.get': {
      await sendFileBatch([msg.path], 'download')
      break
    }
    case 'oneTime.code':
      lastOneTime = { code: msg.code, expiresAt: msg.expiresAt }
      log('one-time code', msg.code)
      break
    case 'file.abort':
      abortIncoming(msg.transferId)
      break
    case 'term.open':
      await openTerminal((buf) => sendBin(encodePty(buf)))
      break
    case 'term.data':
      writeTerminal(msg.data)
      break
    case 'term.resize':
      resizeTerminal(msg.cols, msg.rows)
      break
    case 'term.close':
      closeTerminal()
      break
    case 'privacy.blank':
      setBlankScreen(msg.on)
      break
    case 'host.lock':
      handleSpecial('lock')
      break
    case 'ai.tool': {
      const result = await runTool(msg.name, msg.args, displayId)
      send({ type: 'ai.toolResult', id: msg.id, ...result })
      break
    }
    default:
      break
  }
}

function reconnectNow() {
  const old = ws
  ws = null
  try {
    old?.close()
  } catch {
    /* ignore */
  }
  connect()
}

function connect() {
  const url = wsUrlFromHttp(cfg.serverUrl)
  log('connecting', url)
  const sock = new WebSocket(url)
  ws = sock
  sock.on('open', () => {
    online = true
    send({
      type: 'host.hello',
      protocol: 1,
      name: os.hostname(),
      os: `${os.type()} ${os.release()}`,
      mac: primaryMac(),
      token: cfg.token,
      deviceId: cfg.deviceId,
      accountToken: cfg.accountToken,
      accountUser: cfg.accountUser,
      displays: listDisplays(),
      capabilities: DEFAULT_CAPABILITIES,
    })
  })
  let chain = Promise.resolve()
  sock.on('message', (data, isBinary) => {
    chain = chain
      .then(async () => {
        if (isBinary) {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
          const chunk = decodeFileChunk(buf)
          if (chunk) {
            if (chunk.chunk.length) writeIncoming(chunk.transferId, chunk.chunk)
          }
          return
        }
        const msg = JSON.parse(String(data)) as Msg
        await handle(msg)
      })
      .catch((e) => log('ws message', e))
  })
  sock.on('close', () => {
    if (ws !== sock) return
    online = false
    viewers = 0
    log('disconnected, retry')
    setTimeout(connect, 1500)
  })
  sock.on('error', (e) => log('ws error', e))
}

connect()

log('RemoteAI host started', silent ? 'silent' : 'interactive')
log('password', cfg.password)
if (!silent) setTimeout(openUi, 2500)
