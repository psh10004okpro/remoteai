import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import os from 'node:os'
import { log } from './log.js'

let proc: ChildProcessWithoutNullStreams | null = null
let pty: { write(s: string): void; kill(): void; resize?(c: number, r: number): void } | null = null

export async function openTerminal(onData: (buf: Buffer) => void) {
  closeTerminal()
  try {
    const mod = await import('node-pty')
    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash'
    const p = mod.spawn(shell, os.platform() === 'win32' ? ['-NoLogo'] : [], {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: os.homedir(),
    })
    p.onData((d: string) => onData(Buffer.from(d)))
    pty = {
      write: (s) => p.write(s),
      kill: () => p.kill(),
      resize: (c, r) => p.resize(c, r),
    }
    log('terminal via node-pty')
    return
  } catch (e) {
    log('node-pty missing, fallback powershell pipe', e)
  }
  proc = spawn('powershell.exe', ['-NoLogo', '-NoExit'], {
    cwd: os.homedir(),
    windowsHide: true,
  })
  proc.stdout.on('data', onData)
  proc.stderr.on('data', onData)
}

export function writeTerminal(data: string) {
  if (pty) {
    pty.write(data)
    return
  }
  proc?.stdin.write(data)
}

export function resizeTerminal(cols: number, rows: number) {
  pty?.resize?.(cols, rows)
}

export function closeTerminal() {
  pty?.kill()
  pty = null
  proc?.kill()
  proc = null
}
