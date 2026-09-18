import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { configDir, isPackaged, loadConfig } from './config.js'
import { log } from './log.js'

const LABEL = 'com.remoteai.host'
const PLIST_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents')
const PLIST = path.join(PLIST_DIR, `${LABEL}.plist`)
const require = createRequire(import.meta.url)

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
}

function tsxCli() {
  try {
    return require.resolve('tsx/dist/cli.mjs')
  } catch {
    return path.join(repoRoot(), 'node_modules/tsx/dist/cli.mjs')
  }
}

function programArguments(): string[] {
  if (isPackaged()) {
    const home = (process.env.REMOTEAI_HOME || path.dirname(process.execPath)).replace(/\/$/, '')
    return [path.join(home, 'node'), path.join(home, 'app', 'index.js'), '--silent']
  }
  const cwd = repoRoot()
  const hostEntry = path.join(cwd, 'apps', 'host', 'src', 'index.ts')
  return [process.execPath, tsxCli(), hostEntry, '--silent']
}

function guiDomain() {
  return `gui/${process.getuid?.() ?? 501}`
}

export function writeRuntimeCmd() {
  mkdirSync(PLIST_DIR, { recursive: true })
  const args = programArguments()
    .map((a) => `      <string>${a.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>`)
    .join('\n')
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${args}
    </array>
    <key>WorkingDirectory</key>
    <string>${isPackaged() ? (process.env.REMOTEAI_HOME || path.dirname(process.execPath)) : repoRoot()}</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>REMOTEAI_PACKAGED</key>
      <string>${isPackaged() ? '1' : '0'}</string>
      <key>REMOTEAI_HOME</key>
      <string>${isPackaged() ? (process.env.REMOTEAI_HOME || path.dirname(process.execPath)) : repoRoot()}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
`
  writeFileSync(PLIST, plist)
  return PLIST
}

export function setAutoStart(on: boolean) {
  const plist = writeRuntimeCmd()
  const domain = guiDomain()
  if (on) {
    spawnSync('launchctl', ['bootout', `${domain}/${LABEL}`], { encoding: 'utf8' })
    const r = spawnSync('launchctl', ['bootstrap', domain, plist], { encoding: 'utf8' })
    log('launchctl bootstrap', r.status, (r.stderr || r.stdout || '').trim())
  } else {
    spawnSync('launchctl', ['bootout', `${domain}/${LABEL}`], { encoding: 'utf8' })
    if (existsSync(plist)) unlinkSync(plist)
    log('autostart off')
  }
}

export function isAutoStart(): boolean {
  const r = spawnSync('launchctl', ['print', `${guiDomain()}/${LABEL}`], { encoding: 'utf8' })
  return r.status === 0 || existsSync(PLIST)
}