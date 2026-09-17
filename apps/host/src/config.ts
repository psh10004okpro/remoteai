import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { generatePin, DEFAULT_PORT } from '@remoteai/protocol'

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

const dir = path.join(os.homedir(), 'AppData', 'Roaming', 'RemoteAI')
const file = path.join(dir, 'config.json')

export function configDir() {
  mkdirSync(dir, { recursive: true })
  return dir
}

export function loadConfig(): HostConfig {
  configDir()
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<HostConfig>
    return {
      deviceId: raw.deviceId,
      token: raw.token,
      password: raw.password || generatePin(),
      serverUrl: raw.serverUrl || `http://127.0.0.1:${DEFAULT_PORT}`,
      autoStart: raw.autoStart ?? true,
      sshLan: raw.sshLan ?? false,
      lockOnDisconnect: raw.lockOnDisconnect ?? false,
      accountUser: raw.accountUser,
      accountToken: raw.accountToken,
    }
  } catch {
    const cfg: HostConfig = {
      password: generatePin(),
      serverUrl: `http://127.0.0.1:${DEFAULT_PORT}`,
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
