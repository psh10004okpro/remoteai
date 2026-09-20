import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function logDir() {
  return process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'RemoteAI')
    : path.join(os.homedir(), 'AppData', 'Roaming', 'RemoteAI')
}

const RING = 800
const ring: { t: string; level: string; msg: string }[] = []

function redact(s: string) {
  return s
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
    .replace(/(password|token|secret|credential|totp)["']?\s*[:=]\s*["']?[^"'\s,]+/gi, '$1=***')
}

export function log(...args: unknown[]) {
  const msg = redact(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  const level = /fail|error|denied/i.test(msg) ? 'error' : /retry|disconnect|warn/i.test(msg) ? 'warn' : 'info'
  const row = { t: new Date().toISOString(), level, msg }
  ring.push(row)
  if (ring.length > RING) ring.splice(0, ring.length - RING)
  const line = `[${row.t}] ${msg}`
  console.log(line)
  try {
    const dir = logDir()
    mkdirSync(dir, { recursive: true })
    appendFileSync(path.join(dir, 'host.jsonl'), JSON.stringify(row) + '\n')
  } catch {
    /* ignore */
  }
}

export function recentHostLogs(limit = 200) {
  const n = Math.max(1, Math.min(500, limit))
  if (ring.length) return ring.slice(-n)
  try {
    const raw = readFileSync(path.join(logDir(), 'host.jsonl'), 'utf8')
    return raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(-n)
      .map((l) => JSON.parse(l) as { t: string; level: string; msg: string })
  } catch {
    return []
  }
}
