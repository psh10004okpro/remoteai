import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const dir = path.join(os.homedir(), 'AppData', 'Roaming', 'RemoteAI')
mkdirSync(dir, { recursive: true })
const file = path.join(dir, 'host.log')

export function log(...args: unknown[]) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`
  console.log(line)
  try {
    appendFileSync(file, line + '\n')
  } catch {
    /* ignore */
  }
}
