import { readFileSync } from 'node:fs'
import path from 'node:path'

export const HOST_VERSION = '0.1.4'

export function versionNewer(latest: string, current: string) {
  const a = latest.split('.').map((n) => parseInt(n, 10) || 0)
  const b = current.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true
    if ((a[i] || 0) < (b[i] || 0)) return false
  }
  return false
}

export function installedVersion() {
  const home = process.env.REMOTEAI_HOME
  if (home) {
    try {
      const v = readFileSync(path.join(home, 'VERSION'), 'utf8').trim()
      if (v) return v
    } catch {
      /* pack without VERSION */
    }
  }
  return HOST_VERSION
}
