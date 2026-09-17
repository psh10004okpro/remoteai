import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { configDir, isPackaged, loadConfig } from './config.js'
import { isLocalHub } from './net.js'
import { log } from './log.js'

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const VALUE = 'RemoteAIHost'
const TASK_LOGON = 'RemoteAI Host Logon'
const TASK_BOOT = 'RemoteAI Host Boot'
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

export function writeRuntimeCmd() {
  const starter = path.join(configDir(), 'start-host.cmd')
  if (isPackaged()) {
    const home = (process.env.REMOTEAI_HOME || path.dirname(process.execPath)).replace(/\\$/, '')
    const node = path.join(home, 'node.exe')
    const entry = path.join(home, 'app', 'index.js')
    const cmd = [
      '@echo off',
      `cd /d "${home}"`,
      'set REMOTEAI_PACKAGED=1',
      `set REMOTEAI_HOME=${home}`,
      ':hostloop',
      `"${node}" "${entry}" --silent`,
      'timeout /t 4 /nobreak >nul',
      'goto hostloop',
      '',
    ].join('\r\n')
    writeFileSync(starter, cmd)
    return starter
  }
  const node = process.execPath
  const tsx = tsxCli()
  const cwd = repoRoot()
  const serverEntry = path.join(cwd, 'apps', 'server', 'src', 'index.ts')
  const hostEntry = path.join(cwd, 'apps', 'host', 'src', 'index.ts')
  const hub = isLocalHub(loadConfig().serverUrl)
  const lines = ['@echo off', `cd /d "${cwd}"`]
  if (hub) {
    lines.push(
      'netstat -ano | findstr ":18790" >nul',
      'if errorlevel 1 (',
      `  start "RemoteAI-Server" /min "${node}" "${tsx}" "${serverEntry}"`,
      '  timeout /t 2 /nobreak >nul',
      ')',
    )
  }
  lines.push(
    `:hostloop`,
    `"${node}" "${tsx}" "${hostEntry}" --silent`,
    'timeout /t 4 /nobreak >nul',
    'goto hostloop',
    '',
  )
  const cmd = lines.join('\r\n')
  writeFileSync(starter, cmd)
  return starter
}

export function setAutoStart(on: boolean) {
  const starter = writeRuntimeCmd()
  if (on) {
    const r = spawnSync('reg', ['add', RUN_KEY, '/v', VALUE, '/t', 'REG_SZ', '/d', starter, '/f'], { windowsHide: true })
    log('run-key', r.status)
    const logon = spawnSync(
      'schtasks',
      ['/Create', '/TN', TASK_LOGON, '/SC', 'ONLOGON', '/RL', 'LIMITED', '/IT', '/F', '/TR', starter],
      { windowsHide: true, encoding: 'utf8' },
    )
    log('task logon', logon.status, (logon.stderr || logon.stdout || '').trim())
    const boot = spawnSync(
      'schtasks',
      ['/Create', '/TN', TASK_BOOT, '/SC', 'ONSTART', '/DELAY', '0000:20', '/RL', 'LIMITED', '/F', '/TR', starter],
      { windowsHide: true, encoding: 'utf8' },
    )
    log('task boot', boot.status, (boot.stderr || boot.stdout || '').trim())
  } else {
    spawnSync('reg', ['delete', RUN_KEY, '/v', VALUE, '/f'], { windowsHide: true })
    spawnSync('schtasks', ['/Delete', '/TN', TASK_LOGON, '/F'], { windowsHide: true })
    spawnSync('schtasks', ['/Delete', '/TN', TASK_BOOT, '/F'], { windowsHide: true })
    log('autostart off')
  }
}

export function isAutoStart(): boolean {
  const r = spawnSync('reg', ['query', RUN_KEY, '/v', VALUE], { windowsHide: true, encoding: 'utf8' })
  const t = spawnSync('schtasks', ['/Query', '/TN', TASK_LOGON], { windowsHide: true, encoding: 'utf8' })
  return r.status === 0 || t.status === 0
}
