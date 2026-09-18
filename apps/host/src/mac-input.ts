import koffi from 'koffi'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { log } from './log.js'
import type { SpecialKey } from '@remoteai/protocol'

const require = createRequire(import.meta.url)
const CG = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
const CF = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')

const CGPoint = koffi.struct('CGPoint', { x: 'double', y: 'double' })

const CGEventCreateMouseEvent = CG.func('void * CGEventCreateMouseEvent(void *, uint32, CGPoint, uint32)')
const CGEventCreateScrollWheelEvent = CG.func('void * CGEventCreateScrollWheelEvent(void *, uint32, uint32, int32)')
const CGEventCreateKeyboardEvent = CG.func('void * CGEventCreateKeyboardEvent(void *, uint16, bool)')
const CGEventPost = CG.func('void CGEventPost(uint32, void *)')
const CFRelease = CF.func('void CFRelease(void *)')

const kCGHIDEventTap = 0
const kCGEventLeftMouseDown = 1
const kCGEventLeftMouseUp = 2
const kCGEventRightMouseDown = 3
const kCGEventRightMouseUp = 4
const kCGEventMouseMoved = 5
const kCGEventOtherMouseDown = 25
const kCGEventOtherMouseUp = 26
const kCGScrollEventUnitPixel = 1

export type MacDisplay = {
  id: number
  x: number
  y: number
  width: number
  height: number
  primary: boolean
}

let displayCache: MacDisplay[] | null = null

export function listDisplaysMac(): MacDisplay[] {
  if (displayCache) return displayCache
  const out: MacDisplay[] = []
  try {
    const { Monitor } = require('node-screenshots') as { Monitor: { all(): { x(): number; y(): number; width(): number; height(): number; isPrimary(): boolean }[] } }
    out.push(
      ...Monitor.all().map((m, i) => ({
        id: i,
        x: m.x(),
        y: m.y(),
        width: m.width(),
        height: m.height(),
        primary: m.isPrimary(),
      })),
    )
  } catch (e) {
    log('listDisplaysMac', e)
  }
  if (!out.length) {
    out.push({ id: 0, x: 0, y: 0, width: 1440, height: 900, primary: true })
  }
  displayCache = out
  return out
}

export function resolveDisplay(displayId: number): MacDisplay {
  const displays = listDisplaysMac()
  return displays[displayId] || displays.find((d) => d.primary) || displays[0]
}

const CODE_TO_CG: Record<string, number> = {
  KeyA: 0x00, KeyS: 0x01, KeyD: 0x02, KeyF: 0x03, KeyH: 0x04, KeyG: 0x05,
  KeyZ: 0x06, KeyX: 0x07, KeyC: 0x08, KeyV: 0x09, KeyB: 0x0b, KeyQ: 0x0c,
  KeyW: 0x0d, KeyE: 0x0e, KeyR: 0x0f, KeyY: 0x10, KeyT: 0x11,
  KeyO: 0x1f, KeyU: 0x20, KeyI: 0x22, KeyP: 0x23, KeyL: 0x25, KeyJ: 0x26,
  KeyK: 0x28, KeyN: 0x2d, KeyM: 0x2e,
  Digit1: 0x12, Digit2: 0x13, Digit3: 0x14, Digit4: 0x15, Digit6: 0x16,
  Digit5: 0x17, Equal: 0x18, Digit9: 0x19, Digit7: 0x1a, Minus: 0x1b,
  Digit8: 0x1c, Digit0: 0x1d, BracketRight: 0x1e,
  BracketLeft: 0x21, Quote: 0x27, Semicolon: 0x29, Backslash: 0x2a,
  Comma: 0x2b, Slash: 0x2c, Period: 0x2f, Backquote: 0x32,
  Enter: 0x24, Tab: 0x30, Space: 0x31, Backspace: 0x33, Escape: 0x35,
  MetaLeft: 0x37, ShiftLeft: 0x38, CapsLock: 0x39, AltLeft: 0x3a,
  ControlLeft: 0x3b, ShiftRight: 0x3c, AltRight: 0x3d, ControlRight: 0x3e,
  MetaRight: 0x36, ContextMenu: 0x6e,
  F17: 0x40, VolumeUp: 0x48, VolumeDown: 0x49, Mute: 0x4a,
  Numpad0: 0x53, Numpad1: 0x54, Numpad2: 0x55, Numpad3: 0x56,
  Numpad4: 0x57, Numpad5: 0x58, Numpad6: 0x59, Numpad7: 0x5a,
  Numpad8: 0x5b, Numpad9: 0x5c,
  NumpadDecimal: 0x41, NumpadMultiply: 0x43, NumpadAdd: 0x45,
  NumpadDivide: 0x4b, NumpadSubtract: 0x4e, NumpadEnter: 0x4c,
  F5: 0x60, F6: 0x61, F7: 0x62, F3: 0x63, F8: 0x64, F9: 0x65,
  F11: 0x67, F13: 0x69, F14: 0x6b, F10: 0x6d, F12: 0x6f,
  F15: 0x71, Help: 0x72, Home: 0x73, PageUp: 0x74, Delete: 0x75,
  F4: 0x76, End: 0x77, F2: 0x78, PageDown: 0x79, F1: 0x7a,
  ArrowLeft: 0x7b, ArrowRight: 0x7c, ArrowDown: 0x7d, ArrowUp: 0x7e,
  Insert: 0x72, ScrollLock: 0x6b, Pause: 0x71,
}

export function handleKey(code: string, down: boolean) {
  const kc = CODE_TO_CG[code]
  if (kc == null) return
  const ev = CGEventCreateKeyboardEvent(null, kc, down)
  if (!ev) return
  CGEventPost(kCGHIDEventTap, ev)
  CFRelease(ev)
}

export function handleMouse(msg: {
  action: string
  nx?: number
  ny?: number
  button?: number
  dy?: number
  displayId: number
}) {
  const d = resolveDisplay(msg.displayId)
  if (!d) return
  const x = d.x + (msg.nx ?? 0) * d.width
  const y = d.y + (msg.ny ?? 0) * d.height
  const pt = { x, y }
  const btn = msg.button ?? 0
  let type: number
  let cgBtn = 0
  if (msg.action === 'move') {
    type = kCGEventMouseMoved
  } else if (msg.action === 'down') {
    if (btn === 0) type = kCGEventLeftMouseDown
    else if (btn === 2) { type = kCGEventRightMouseDown; cgBtn = 1 }
    else { type = kCGEventOtherMouseDown; cgBtn = 2 }
  } else if (msg.action === 'up') {
    if (btn === 0) type = kCGEventLeftMouseUp
    else if (btn === 2) { type = kCGEventRightMouseUp; cgBtn = 1 }
    else { type = kCGEventOtherMouseUp; cgBtn = 2 }
  } else if (msg.action === 'wheel') {
    const ev = CGEventCreateScrollWheelEvent(null, kCGScrollEventUnitPixel, 1, Math.round(msg.dy ?? 0))
    if (!ev) return
    CGEventPost(kCGHIDEventTap, ev)
    CFRelease(ev)
    return
  } else {
    return
  }
  const ev = CGEventCreateMouseEvent(null, type, pt, cgBtn)
  if (!ev) return
  CGEventPost(kCGHIDEventTap, ev)
  CFRelease(ev)
}

export function handleText(text: string) {
  if (!text) return
  osa(`tell application "System Events" to keystroke ${JSON.stringify(text)}`)
}

function osa(script: string) {
  try {
    execSync(`osascript -e ${JSON.stringify(script)}`, { stdio: 'ignore' })
    return true
  } catch (e) {
    log('osascript', e)
    return false
  }
}

export function chord(codes: string[]) {
  for (const c of codes) handleKey(c, true)
  for (const c of [...codes].reverse()) handleKey(c, false)
}

export function handleSpecial(key: SpecialKey) {
  switch (key) {
    case 'cad':
      log('handleSpecial', 'cad is not supported on macOS')
      break
    case 'taskmgr':
      execSync('open -a "Activity Monitor"', { stdio: 'ignore' })
      break
    case 'lock':
      if (!osa('tell application "System Events" to keystroke "q" using {command down, control down}')) {
        try { execSync('open -a ScreenSaverEngine', { stdio: 'ignore' }) } catch (e) { log('lock', e) }
      }
      break
    case 'desktop':
      handleKey('F11', true)
      handleKey('F11', false)
      break
    case 'explorer':
      try { execSync('open -a Finder', { stdio: 'ignore' }) } catch (e) { log('explorer', e) }
      break
    case 'win':
      osa('tell application "System Events" to key code 126 using {control down}')
      break
    case 'alttab':
      chord(['AltLeft', 'Tab'])
      break
    case 'altf4':
      chord(['MetaLeft', 'KeyQ'])
      break
    case 'prtsc':
      osa('tell application "System Events" to keystroke "3" using {command down, shift down}')
      break
  }
}