import { generateKeyPairSync } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import ssh2 from 'ssh2'
const { Server } = ssh2
import { configDir } from './config.js'
import { log } from './log.js'

let server: InstanceType<typeof Server> | null = null

function hostKeyPath() {
  return path.join(configDir(), 'ssh_host_key')
}

function loadHostKey() {
  const p = hostKeyPath()
  if (!existsSync(p)) {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
    writeFileSync(p, pem, { mode: 0o600 })
  }
  return readFileSync(p)
}

async function attachShell(stream: { write(d: Buffer | string): void; on(ev: string, cb: (...args: any[]) => void): void; exit(c: number): void; end(): void }, command?: string) {
  try {
    const pty = await import('node-pty')
    const p = pty.spawn('powershell.exe', command ? ['-NoLogo', '-Command', command] : ['-NoLogo'], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: os.homedir(),
    })
    p.onData((d) => stream.write(d))
    stream.on('data', (d: Buffer) => p.write(d.toString()))
    stream.on('close', () => p.kill())
    p.onExit(({ exitCode }) => {
      try {
        stream.exit(exitCode ?? 0)
        stream.end()
      } catch {
        /* ignore */
      }
    })
    return
  } catch (e) {
    log('ssh pty fallback', e)
  }
  const shell = spawn('powershell.exe', command ? ['-NoLogo', '-Command', command] : ['-NoLogo'], {
    cwd: os.homedir(),
    windowsHide: true,
  })
  shell.stdout.on('data', (d) => stream.write(d))
  shell.stderr.on('data', (d) => stream.write(d))
  stream.on('data', (d) => shell.stdin.write(d))
  stream.on('close', () => shell.kill())
  shell.on('exit', (code) => {
    try {
      stream.exit(code ?? 0)
      stream.end()
    } catch {
      /* ignore */
    }
  })
}

export function startSsh(opts: { password: string; lan: boolean }) {
  stopSsh()
  const bind = opts.lan ? '0.0.0.0' : '127.0.0.1'
  const key = loadHostKey()
  server = new Server({ hostKeys: [key] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.password === opts.password) ctx.accept()
      else ctx.reject()
    })
    client.on('session', (accept) => {
      const session = accept()
      session.on('pty', (acc) => acc())
      session.on('shell', (acc) => {
        void attachShell(acc())
      })
      session.on('exec', (acc, _rej, info) => {
        void attachShell(acc(), info.command)
      })
    })
  })
  server.listen(2222, bind, () => log(`ssh listening ${bind}:2222 user=${os.userInfo().username}`))
  server.on('error', (e) => log('ssh error', e))
}

export function stopSsh() {
  try {
    server?.close()
  } catch {
    /* ignore */
  }
  server = null
}
