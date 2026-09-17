import os from 'node:os'
import { DEFAULT_PORT } from '@remoteai/protocol'

export function lanIps() {
  const out: string[] = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) out.push(n.address)
    }
  }
  return out
}

export function lanUrls(port = DEFAULT_PORT) {
  return lanIps().map((ip) => `http://${ip}:${port}`)
}

export function primaryMac() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00') return n.mac
    }
  }
  return undefined
}

export function wsUrlFromHttp(url: string) {
  const u = new URL(url)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.pathname = '/ws'
  u.search = ''
  u.hash = ''
  return u.toString()
}

export function isLocalHub(serverUrl: string) {
  try {
    const host = new URL(serverUrl).hostname
    return host === '127.0.0.1' || host === 'localhost' || host === '::1'
  } catch {
    return true
  }
}
