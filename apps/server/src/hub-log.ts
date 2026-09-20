import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data')
const file = path.join(dataDir, 'hub.jsonl')
const RING = 2000
const ring: HubLog[] = []

export type HubLog = {
  t: string
  level: 'info' | 'warn' | 'error'
  event: string
  [k: string]: unknown
}

export function redactText(s: string) {
  return s
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
    .replace(/(password|token|secret|credential|totp|recovery)["']?\s*[:=]\s*["']?[^"'\s,]+/gi, '$1=***')
}

export function hubLog(level: HubLog['level'], event: string, fields: Record<string, unknown> = {}) {
  const row: HubLog = { t: new Date().toISOString(), level, event }
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue
    if (/pass|token|secret|credential|totp/i.test(k)) continue
    row[k] = typeof v === 'string' ? redactText(v) : v
  }
  ring.push(row)
  if (ring.length > RING) ring.splice(0, ring.length - RING)
  try {
    mkdirSync(dataDir, { recursive: true })
    appendFileSync(file, JSON.stringify(row) + '\n')
  } catch {
    /* ignore */
  }
}

export function recentHubLogs(limit = 200, level?: HubLog['level']) {
  const n = Math.max(1, Math.min(1000, limit))
  const src = level ? ring.filter((x) => x.level === level) : ring
  return src.slice(-n)
}
