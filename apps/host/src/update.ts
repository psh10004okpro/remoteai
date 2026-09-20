import { createWriteStream, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { isPackaged } from './config.js'
import { log } from './log.js'
import { setAutoStart } from './autostart.js'
import { installedVersion, versionNewer } from './version.js'
import { notify } from './notify.js'

export type UpdateInfo = {
  current: string
  latest: string
  available: boolean
  snoozed: boolean
}

let lastCheck: UpdateInfo = {
  current: installedVersion(),
  latest: installedVersion(),
  available: false,
  snoozed: false,
}

export function lastUpdateInfo() {
  return lastCheck
}

export async function checkForUpdate(serverUrl: string, snoozeUntil?: number, snoozedVersion?: string) {
  const current = installedVersion()
  lastCheck = { current, latest: current, available: false, snoozed: false }
  try {
    const r = await fetch(serverUrl.replace(/\/$/, '') + '/api/version', { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return lastCheck
    const j = (await r.json()) as { version?: string }
    const latest = String(j.version || '').trim() || current
    const available = versionNewer(latest, current)
    const snoozed =
      available &&
      snoozedVersion === latest &&
      typeof snoozeUntil === 'number' &&
      snoozeUntil > Date.now()
    lastCheck = { current, latest, available, snoozed }
    if (available && !snoozed) {
      log('update available', current, '->', latest)
      notify('RemoteAI', `새 버전 ${latest}이 있습니다. 설정에서 업데이트하거나 그대로 쓸 수 있습니다.`)
    }
  } catch (e) {
    log('update check', e)
  }
  return lastCheck
}

function homeDir() {
  return process.env.REMOTEAI_HOME || process.cwd()
}

export async function downloadAndUpdate(serverUrl: string) {
  const base = serverUrl.replace(/\/$/, '')
  const win = process.platform === 'win32'
  const name = win ? 'RemoteAI-Setup.exe' : 'RemoteAI-Mac.zip'
  const url = `${base}/${name}`
  const dest = path.join(os.tmpdir(), name)
  log('update download', url)
  const r = await fetch(url)
  if (!r.ok || !r.body) throw new Error('설치 파일을 받지 못했습니다. (' + r.status + ')')
  await pipeline(Readable.fromWeb(r.body as import('node:stream/web').ReadableStream), createWriteStream(dest))
  if (win) {
    const child = spawn(dest, ['/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES', '/CLOSEAPPLICATIONS', '/FORCECLOSEAPPLICATIONS'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
  } else {
    const app = path.join(os.homedir(), 'Applications', 'RemoteAI')
    spawn('ditto', ['-x', '-k', dest, app], { detached: true, stdio: 'ignore' }).unref()
  }
  setTimeout(() => process.exit(0), 1200)
}

export function uninstallHost() {
  setAutoStart(false)
  const home = homeDir()
  if (process.platform === 'win32') {
    const svc = path.join(home, 'RemoteAI-service.exe')
    if (existsSync(svc)) {
      spawn(svc, ['stop'], { windowsHide: true, stdio: 'ignore' })
      spawn(svc, ['uninstall'], { windowsHide: true, stdio: 'ignore' })
    }
    const unins = ['unins000.exe', 'unins001.exe']
      .map((n) => path.join(home, n))
      .find((p) => existsSync(p))
    if (unins) {
      spawn(unins, ['/VERYSILENT', '/NORESTART'], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    } else {
      const cmd = path.join(home, '제거.cmd')
      if (existsSync(cmd)) spawn('cmd.exe', ['/c', cmd], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    }
  } else {
    spawn('launchctl', ['bootout', `gui/${process.getuid?.() || 501}/com.remoteai.host`], { stdio: 'ignore' })
    const app = path.join(os.homedir(), 'Applications', 'RemoteAI')
    spawn('rm', ['-rf', app], { detached: true, stdio: 'ignore' }).unref()
  }
  setTimeout(() => process.exit(0), 1500)
}

export function canSelfUpdate() {
  return isPackaged() || !!process.env.REMOTEAI_HOME
}
