import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { generatePin, DEFAULT_PORT } from '@remoteai/protocol'

export const PUBLIC_HUB = 'https://remote.unwoldamstudio.com'

export function isPackaged() {
  return process.env.REMOTEAI_PACKAGED === '1'
}

function migrateHubUrl(url?: string) {
  if (!url) return ''
  if (url.includes('sslip.io') || url.includes('n14di7zep9bvjhkkrk1rlfw9')) return PUBLIC_HUB
  return url.replace(/\/$/, '')
}

export function defaultServerUrl() {
  if (process.env.REMOTEAI_HUB) return process.env.REMOTEAI_HUB.replace(/\/$/, '')
  if (isPackaged()) return PUBLIC_HUB
  return `http://127.0.0.1:${DEFAULT_PORT}`
}

export type HostConfig = {
  deviceId?: string
  token?: string
  password: string
  serverUrl: string
  autoStart: boolean
  sshLan: boolean
  lockOnDisconnect: boolean
  accountUser?: string
  accountToken?: string
}

const dir =
  process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'RemoteAI')
    : path.join(os.homedir(), 'AppData', 'Roaming', 'RemoteAI')
const file = path.join(dir, 'config.json')

export function configDir() {
  mkdirSync(dir, { recursive: true })
  return dir
}

export function loadConfig(): HostConfig {
  configDir()
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<HostConfig>
    const serverUrl = migrateHubUrl(raw.serverUrl) || defaultServerUrl()
    const cfg: HostConfig = {
      deviceId: raw.deviceId,
      token: raw.token,
      password: raw.password || generatePin(),
      serverUrl,
      autoStart: raw.autoStart ?? true,
      sshLan: raw.sshLan ?? false,
      lockOnDisconnect: raw.lockOnDisconnect ?? false,
      accountUser: raw.accountUser,
      accountToken: raw.accountToken,
    }
    if (serverUrl !== (raw.serverUrl || '').replace(/\/$/, '')) saveConfig(cfg)
    return cfg
  } catch {
    const cfg: HostConfig = {
      password: generatePin(),
      serverUrl: defaultServerUrl(),
      autoStart: true,
      sshLan: false,
      lockOnDisconnect: false,
    }
    saveConfig(cfg)
    return cfg
  }
}

export function saveConfig(cfg: HostConfig) {
  configDir()
  writeFileSync(file, JSON.stringify(cfg, null, 2))
}

export function dropDir() {
  const p = path.join(os.homedir(), 'Downloads', 'RemoteAI')
  mkdirSync(p, { recursive: true })
  return p
}
