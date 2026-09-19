import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { captureJpegBase64 } from './capture.js'
import { DEFAULT_QUALITY } from '@remoteai/protocol'
import { handleMouse, handleText, chord } from './input.js'
import { getClipboard, setClipboardText } from './clipboard.js'

const execp = promisify(exec)

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  displayId: number,
): Promise<{ ok: boolean; text?: string; imageJpegBase64?: string }> {
  try {
    switch (name) {
      case 'screenshot': {
        const imageJpegBase64 = await captureJpegBase64(displayId, { ...DEFAULT_QUALITY, maxWidth: 1280, jpegQuality: 50 })
        return { ok: !!imageJpegBase64, imageJpegBase64: imageJpegBase64 || undefined, text: imageJpegBase64 ? 'ok' : 'capture failed' }
      }
      case 'click': {
        const nx = Number(args.nx)
        const ny = Number(args.ny)
        const button = args.button === 'right' ? 2 : args.button === 'middle' ? 1 : 0
        handleMouse({ action: 'move', nx, ny, displayId })
        handleMouse({ action: 'down', nx, ny, button, displayId })
        handleMouse({ action: 'up', nx, ny, button, displayId })
        return { ok: true, text: 'clicked' }
      }
      case 'type_text':
        handleText(String(args.text || ''))
        return { ok: true, text: 'typed' }
      case 'key': {
        const combo = String(args.combo || '')
        const parts = combo.split('+').map((s) => s.trim()).filter(Boolean)
        chord(parts)
        return { ok: true, text: `pressed ${combo}` }
      }
      case 'run': {
        if (process.env.REMOTEAI_AI_SHELL !== '1') {
          return { ok: false, text: '원격 셸은 꺼져 있습니다. 호스트에 REMOTEAI_AI_SHELL=1 을 설정하세요.' }
        }
        const cmd = String(args.command || '')
        const line = process.platform === 'darwin' ? cmd : `powershell -NoProfile -Command ${escapePs(cmd)}`
        const { stdout, stderr } = await execp(line, {
          cwd: os.homedir(),
          windowsHide: true,
          timeout: 30_000,
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
          shell: process.platform === 'darwin' ? '/bin/zsh' : true,
        })
        return { ok: true, text: (stdout + stderr).slice(0, 8000) || '(no output)' }
      }
      case 'open_path': {
        const target = String(args.target || '')
        const line =
          process.platform === 'darwin'
            ? `open ${JSON.stringify(target)}`
            : `powershell -NoProfile -Command Start-Process ${escapePs(target)}`
        await execp(line, { windowsHide: true })
        return { ok: true, text: 'opened' }
      }
      case 'list_dir': {
        const dir = String(args.path || os.homedir())
        const names = await readdir(dir)
        const lines = []
        for (const n of names.slice(0, 80)) {
          const s = await stat(path.join(dir, n)).catch(() => null)
          lines.push(`${s?.isDirectory() ? 'd' : 'f'} ${n}`)
        }
        return { ok: true, text: lines.join('\n') }
      }
      case 'list_windows': {
        if (process.platform === 'darwin') {
          try {
            const { stdout } = await execp(
              `osascript -e 'tell application "System Events" to get name of every process whose background only is false'`,
            )
            return { ok: true, text: stdout }
          } catch {
            return { ok: true, text: '' }
          }
        }
        const { listWindowTitles } = await import('./win32.js')
        return { ok: true, text: listWindowTitles().join('\n') }
      }
      case 'clipboard_get': {
        const c = getClipboard()
        if (c.kind === 'files') return { ok: true, text: c.files.join('\n') }
        return { ok: true, text: c.text || '' }
      }
      case 'clipboard_set':
        setClipboardText(String(args.text || ''))
        return { ok: true, text: 'clipboard set' }
      default:
        return { ok: false, text: `unknown tool ${name}` }
    }
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : String(e) }
  }
}

function escapePs(s: string) {
  return `'${s.replace(/'/g, "''")}'`
}
