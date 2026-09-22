import http from 'node:http'
import { createWriteStream, existsSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { HOST_LOCAL_PORT } from '@remoteai/protocol'
import { isPackaged, type HostConfig } from './config.js'
import { isLocalHub, lanUrls } from './net.js'
import { setClipboardFiles } from './clipboard.js'
import { sendMagic } from './wol.js'
import { log, recentHostLogs } from './log.js'
import { canSelfUpdate, checkForUpdate, downloadAndUpdate, lastUpdateInfo, uninstallHost } from './update.js'
import { installedVersion } from './version.js'
import { collectStats } from './stats.js'

export type LocalState = {
  cfg: () => HostConfig
  save: (patch: Partial<HostConfig>) => void
  online: () => boolean
  deviceId: () => string
  displays: () => unknown
  oneTime?: () => void
  lastOneTime?: () => { code: string; expiresAt: number } | null
  login?: (
    username: string,
    password: string,
    totp?: string,
  ) => Promise<{ ok: boolean; error?: string; username?: string; totpRequired?: boolean }>
  logout?: () => void
}

const clipRoot = path.join(os.tmpdir(), 'RemoteAI-clip')

export function startLocalApi(state: LocalState, port = HOST_LOCAL_PORT) {
  const server = http.createServer((req, res) => {
    const hostHead = String(req.headers.host || '').split(':')[0].replace(/^\[|\]$/g, '')
    if (hostHead && hostHead !== '127.0.0.1' && hostHead !== 'localhost' && hostHead !== '::1') {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    const origin = req.headers.origin || ''
    const allow = originOk(origin, state.cfg().serverUrl)
    if (allow && origin) res.setHeader('Access-Control-Allow-Origin', origin)
    else if (allow) res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/local') {
      const cfg = state.cfg()
      json(res, {
        deviceId: state.deviceId(),
        serverUrl: cfg.serverUrl,
        autoStart: cfg.autoStart,
        sshLan: cfg.sshLan,
        lockOnDisconnect: cfg.lockOnDisconnect,
        online: state.online(),
        displays: state.displays(),
        lanUrls: lanUrls(),
        username: process.env.USER || process.env.USERNAME,
        hostname: os.hostname() || process.env.COMPUTERNAME,
        oneTime: state.lastOneTime?.() || null,
        accountUser: cfg.accountUser || null,
        hub: isLocalHub(cfg.serverUrl),
        hubUrls: lanUrls(),
        version: installedVersion(),
        packaged: isPackaged() || canSelfUpdate(),
        update: lastUpdateInfo(),
      })
      return
    }
    if (req.method === 'GET' && url.pathname === '/local/stats') {
      json(res, collectStats())
      return
    }
    if (req.method === 'GET' && url.pathname === '/local/logs') {
      if (!allow) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      json(res, { logs: recentHostLogs(Number(url.searchParams.get('limit') || 200)) })
      return
    }
    if (req.method === 'GET' && url.pathname === '/local/pin') {
      if (!allow) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      json(res, { password: state.cfg().password })
      return
    }
    if (req.method === 'POST' && url.pathname === '/local/onetime') {
      state.oneTime?.()
      setTimeout(() => json(res, { ok: true, oneTime: state.lastOneTime?.() || null }), 400)
      return
    }
    if (req.method === 'POST' && url.pathname === '/local/login') {
      readBody(req).then(async (body) => {
        const b = body as { username?: string; password?: string; totp?: string }
        if (!state.login) {
          json(res, { ok: false, error: 'login unavailable' })
          return
        }
        const r = await state.login(String(b.username || ''), String(b.password || ''), b.totp)
        json(res, r)
      })
      return
    }
    if (req.method === 'POST' && url.pathname === '/local/check-update') {
      if (!allow) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      const cfg = state.cfg()
      void checkForUpdate(cfg.serverUrl, cfg.updateSnoozeUntil, cfg.snoozedVersion).then((u) => json(res, { ok: true, update: u }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/local/snooze-update') {
      if (!allow) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      const u = lastUpdateInfo()
      state.save({ updateSnoozeUntil: Date.now() + 7 * 24 * 3600 * 1000, snoozedVersion: u.latest })
      void checkForUpdate(state.cfg().serverUrl, Date.now() + 7 * 24 * 3600 * 1000, u.latest)
      json(res, { ok: true })
      return
    }
    if (req.method === 'POST' && url.pathname === '/local/update') {
      if (!allow) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      json(res, { ok: true, message: '설치 파일을 받은 뒤 호스트를 다시 시작합니다.' })
      void downloadAndUpdate(state.cfg().serverUrl).catch((e) => log('update', e))
      return
    }
    if (req.method === 'POST' && url.pathname === '/local/uninstall') {
      if (!allow) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      json(res, { ok: true, message: '이 컴퓨터에서 호스트를 제거합니다.' })
      uninstallHost()
      return
    }
    if (req.method === 'POST' && url.pathname === '/local/logout') {
      state.logout?.()
      json(res, { ok: true })
      return
    }
    if (req.method === 'POST' && url.pathname === '/local/clip-file') {
      const batch = (url.searchParams.get('batch') || 'x').replace(/[^\w.-]/g, '')
      const relRaw = url.searchParams.get('path') || 'file.bin'
      const rel = path.normalize(relRaw).replace(/^(\.\.(\/|\\|$))+/, '').replace(/\\/g, '/')
      if (rel.includes('..')) {
        res.writeHead(400)
        res.end('bad path')
        return
      }
      const dest = path.join(clipRoot, batch, ...rel.split('/'))
      mkdirSync(path.dirname(dest), { recursive: true })
      const stream = createWriteStream(dest)
      req.pipe(stream)
      stream.on('finish', () => json(res, { ok: true, dest }))
      stream.on('error', (e) => {
        log('clip-file', e)
        res.writeHead(500)
        res.end('write failed')
      })
      return
    }
    if (req.method === 'POST' && url.pathname === '/local/wol') {
      readBody(req).then((body) => {
        const mac = String((body as { mac?: string }).mac || '')
        if (!mac) {
          json(res, { ok: false, error: 'mac required' })
          return
        }
        sendMagic(mac)
        json(res, { ok: true, via: 'local' })
      })
      return
    }
    if (req.method === 'POST' && url.pathname === '/local/clip-commit') {
      const batch = (url.searchParams.get('batch') || 'x').replace(/[^\w.-]/g, '')
      const base = path.join(clipRoot, batch)
      try {
        const roots = listRoots(base)
        setClipboardFiles(roots)
        json(res, { ok: true, roots })
      } catch (e) {
        log('clip-commit', e)
        json(res, { ok: false, error: String(e) })
      }
      return
    }
    if (req.method === 'POST' && url.pathname === '/local') {
      readBody(req).then((body) => {
        state.save(body as Partial<HostConfig>)
        json(res, { ok: true })
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
  server.listen(port, '127.0.0.1')
  return server
}

function originOk(origin: string, serverUrl: string) {
  if (!origin) return false
  try {
    const u = new URL(origin)
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1') return true
    return new URL(serverUrl).origin === u.origin
  } catch {
    return false
  }
}

function listRoots(dir: string) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).map((n) => path.join(dir, n))
}

function json(res: http.ServerResponse, data: unknown) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

function readBody(req: http.IncomingMessage) {
  return new Promise<unknown>((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        resolve({})
      }
    })
  })
}
