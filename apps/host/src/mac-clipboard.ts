import { spawnSync } from 'node:child_process'
import { log } from './log.js'

let ignoreUntil = 0
let lastHash = ''

function sh(cmd: string, args: string[], input?: string): string | null {
  const r = spawnSync(cmd, args, { encoding: 'utf8', input, windowsHide: true })
  if (r.status !== 0) return null
  return r.stdout
}

function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return String(h)
}

function currentHash(): string {
  const text = sh('pbpaste', []) ?? ''
  const files = getFileList()
  return hash(JSON.stringify([text, files]))
}

function getFileList(): string[] {
  const script = `set out to ""
tell application "System Events"
  try
    set theFiles to (the clipboard as record)
  on error
    return ""
  end try
end tell
try
  set posixPaths to {}
  set theItems to (the clipboard as «class furl» list)
  repeat with f in theItems
    set end of posixPaths to (POSIX path of f)
  end repeat
  set AppleScript's text item delimiters to "\\n"
  return posixPaths as text
on error
  return ""
end try`
  const out = sh('osascript', ['-e', script])
  if (!out) return []
  return out.split('\n').map((s) => s.trim()).filter(Boolean)
}

export function markLocalClipboard() {
  ignoreUntil = Date.now() + 800
  lastHash = currentHash()
}

export function clipboardChanged(): boolean {
  const h = currentHash()
  if (h === lastHash) return false
  lastHash = h
  if (Date.now() < ignoreUntil) return false
  return true
}

export function getClipboard() {
  const files = getFileList()
  if (files.length) return { kind: 'files' as const, files, text: null as string | null }
  const text = sh('pbpaste', []) ?? ''
  return { kind: 'text' as const, files: [] as string[], text }
}

export function setClipboardText(text: string) {
  markLocalClipboard()
  try {
    const r = spawnSync('pbcopy', [], { input: text, windowsHide: true })
    if (r.status !== 0) throw new Error(`pbcopy exited ${r.status}`)
  } catch (e) {
    log('pbcopy failed, osascript fallback', e)
    const esc = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    sh('osascript', ['-e', `set the clipboard to "${esc}"`])
  }
}

export function setClipboardFiles(paths: string[]) {
  markLocalClipboard()
  try {
    const items = paths
      .map((p) => `POSIX file "${p.replace(/"/g, '\\"')}"`)
      .join(', ')
    const script = `set the clipboard to {${items}}`
    const r = spawnSync('osascript', ['-e', script], { windowsHide: true })
    if (r.status !== 0) throw new Error(`osascript exited ${r.status}`)
  } catch (e) {
    log('osascript setClipboardFiles failed', e)
  }
}

export function initClipboardSeq() {
  lastHash = currentHash()
}