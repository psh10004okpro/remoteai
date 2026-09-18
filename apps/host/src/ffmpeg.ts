import { existsSync } from 'node:fs'
import path from 'node:path'

export function ffmpegBin() {
  const names = process.platform === 'win32' ? ['ffmpeg.exe'] : ['ffmpeg']
  const dirs = [process.env.REMOTEAI_HOME, path.dirname(process.execPath), process.cwd()].filter(
    (d): d is string => !!d,
  )
  for (const dir of dirs) {
    for (const name of names) {
      const p = path.join(dir, name)
      if (existsSync(p)) return p
    }
  }
  return names[0].replace(/\.exe$/, '')
}
