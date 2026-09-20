import { HOST_LOCAL_PORT } from '@remoteai/protocol'

export const HOST_SETUP_URL = '/RemoteAI-Setup.exe'
export const HOST_SETUP_MAC_URL = '/RemoteAI-Mac.zip'

export function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}

export function localHostUrl() {
  return `http://127.0.0.1:${HOST_LOCAL_PORT}/local`
}

export type LocalHostInfo = {
  deviceId: string
  password?: string
  serverUrl: string
  autoStart: boolean
  sshLan: boolean
  lockOnDisconnect: boolean
  online: boolean
  lanUrls: string[]
  username?: string
  hostname?: string
  oneTime?: { code: string; expiresAt: number } | null
  accountUser?: string | null
  hub?: boolean
  hubUrls?: string[]
  version?: string
  packaged?: boolean
  update?: { current: string; latest: string; available: boolean; snoozed: boolean }
}

export async function fetchLocalHost(): Promise<LocalHostInfo | null> {
  try {
    const r = await fetch(localHostUrl(), { signal: AbortSignal.timeout(600) })
    if (!r.ok) return null
    return (await r.json()) as LocalHostInfo
  } catch {
    return null
  }
}

export async function fetchLocalPin(): Promise<string> {
  const r = await fetch(localHostUrl() + '/pin', { signal: AbortSignal.timeout(800) })
  if (!r.ok) return ''
  const body = (await r.json()) as { password?: string }
  return body.password || ''
}

export function rememberId(id: string) {
  const ids = loadRecent().filter((x) => x !== id)
  ids.unshift(id)
  localStorage.setItem('remoteai.recent', JSON.stringify(ids.slice(0, 8)))
}

export function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem('remoteai.recent') || '[]')
  } catch {
    return []
  }
}
