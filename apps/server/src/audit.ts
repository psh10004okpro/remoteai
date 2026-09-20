import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data')

export function audit(event: string, fields: Record<string, string | number | boolean | null | undefined> = {}) {
  const row: Record<string, unknown> = { t: new Date().toISOString(), event }
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue
    if (/pass|token|secret|credential/i.test(k)) continue
    row[k] = v
  }
  const line = JSON.stringify(row) + '\n'
  void mkdir(dataDir, { recursive: true })
    .then(() => appendFile(path.join(dataDir, 'audit.jsonl'), line))
    .catch(() => undefined)
}
