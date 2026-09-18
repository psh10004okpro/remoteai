import { spawnSync } from 'node:child_process'
import {
  GetClipboardSequenceNumber,
  readClipboardFiles,
  readClipboardText,
  writeClipboardFiles,
  writeClipboardText,
} from './win32.js'
import { log } from './log.js'

let lastSeq = 0
let ignoreUntil = 0

export function markLocalClipboard() {
  ignoreUntil = Date.now() + 800
  lastSeq = GetClipboardSequenceNumber()
}

export function clipboardChanged(): boolean {
  const seq = GetClipboardSequenceNumber()
  if (seq === lastSeq) return false
  lastSeq = seq
  if (Date.now() < ignoreUntil) return false
  return true
}

export function getClipboard() {
  const files = readClipboardFiles()
  if (files.length) return { kind: 'files' as const, files, text: null as string | null }
  const text = readClipboardText()
  return { kind: 'text' as const, files: [] as string[], text }
}

export function setClipboardText(text: string) {
  markLocalClipboard()
  try {
    writeClipboardText(text)
  } catch (e) {
    log('writeClipboardText failed, powershell fallback', e)
    spawnSync('powershell', ['-NoProfile', '-Command', 'Set-Clipboard -Value $env:RAI_CLIP'], {
      env: { ...process.env, RAI_CLIP: text },
      windowsHide: true,
    })
  }
}

export function setClipboardFiles(paths: string[]) {
  markLocalClipboard()
  try {
    writeClipboardFiles(paths)
  } catch (e) {
    log('writeClipboardFiles failed, powershell fallback', e)
    const list = paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(',')
    const script = `
Add-Type -AssemblyName System.Windows.Forms
$c = New-Object System.Collections.Specialized.StringCollection
foreach ($p in @(${list})) { [void]$c.Add($p) }
[System.Windows.Forms.Clipboard]::SetFileDropList($c)
`
    spawnSync('powershell', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true })
  }
}

export function initClipboardSeq() {
  lastSeq = GetClipboardSequenceNumber()
}
