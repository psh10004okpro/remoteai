import type { SpecialKey } from '@remoteai/protocol'
import { keyEvent, mouseButton, mouseWheel, moveMouseAbs, sendUnicode, trySendSas, listDisplaysWin } from './win32.js'
import { listDisplays } from './capture.js'

const CODE_TO_VK: Record<string, number> = {
  Backspace: 0x08,
  Tab: 0x09,
  Enter: 0x0d,
  ShiftLeft: 0xa0,
  ShiftRight: 0xa1,
  ControlLeft: 0xa2,
  ControlRight: 0xa3,
  AltLeft: 0xa4,
  AltRight: 0xa5,
  Pause: 0x13,
  CapsLock: 0x14,
  Escape: 0x1b,
  Space: 0x20,
  PageUp: 0x21,
  PageDown: 0x22,
  End: 0x23,
  Home: 0x24,
  ArrowLeft: 0x25,
  ArrowUp: 0x26,
  ArrowRight: 0x27,
  ArrowDown: 0x28,
  Insert: 0x2d,
  Delete: 0x2e,
  MetaLeft: 0x5b,
  MetaRight: 0x5c,
  ContextMenu: 0x5d,
  Numpad0: 0x60,
  Numpad1: 0x61,
  Numpad2: 0x62,
  Numpad3: 0x63,
  Numpad4: 0x64,
  Numpad5: 0x65,
  Numpad6: 0x66,
  Numpad7: 0x67,
  Numpad8: 0x68,
  Numpad9: 0x69,
  NumpadMultiply: 0x6a,
  NumpadAdd: 0x6b,
  NumpadSubtract: 0x6d,
  NumpadDecimal: 0x6e,
  NumpadDivide: 0x6f,
  F1: 0x70,
  F2: 0x71,
  F3: 0x72,
  F4: 0x73,
  F5: 0x74,
  F6: 0x75,
  F7: 0x76,
  F8: 0x77,
  F9: 0x78,
  F10: 0x79,
  F11: 0x7a,
  F12: 0x7b,
  NumLock: 0x90,
  ScrollLock: 0x91,
  Semicolon: 0xba,
  Equal: 0xbb,
  Comma: 0xbc,
  Minus: 0xbd,
  Period: 0xbe,
  Slash: 0xbf,
  Backquote: 0xc0,
  BracketLeft: 0xdb,
  Backslash: 0xdc,
  BracketRight: 0xdd,
  Quote: 0xde,
}

for (let i = 0; i < 10; i++) CODE_TO_VK[`Digit${i}`] = 0x30 + i
for (let i = 0; i < 26; i++) CODE_TO_VK[`Key${String.fromCharCode(65 + i)}`] = 0x41 + i

export function resolveDisplay(displayId: number) {
  const displays = listDisplays()
  return displays[displayId] || displays.find((d) => d.primary) || displays[0]
}

export function handleMouse(opts: {
  action: 'move' | 'down' | 'up' | 'wheel'
  nx?: number
  ny?: number
  button?: number
  dy?: number
  displayId: number
}) {
  const d = resolveDisplay(opts.displayId)
  if (!d) return
  if (opts.action === 'move' || opts.action === 'down' || opts.action === 'up') {
    if (opts.nx != null && opts.ny != null) {
      const x = d.x + opts.nx * d.width
      const y = d.y + opts.ny * d.height
      moveMouseAbs(x, y)
    }
  }
  if (opts.action === 'down') mouseButton(opts.button ?? 0, true)
  if (opts.action === 'up') mouseButton(opts.button ?? 0, false)
  if (opts.action === 'wheel') mouseWheel(opts.dy ?? 0)
}

export function handleKey(code: string, down: boolean) {
  const vk = CODE_TO_VK[code]
  if (vk == null) return
  keyEvent(vk, down)
}

export function handleText(text: string) {
  sendUnicode(text)
}

export function chord(codes: string[]) {
  for (const c of codes) handleKey(c, true)
  for (const c of [...codes].reverse()) handleKey(c, false)
}

export function handleSpecial(key: SpecialKey) {
  switch (key) {
    case 'cad':
      if (!trySendSas()) chord(['ControlLeft', 'AltLeft', 'Delete'])
      break
    case 'taskmgr':
      chord(['ControlLeft', 'ShiftLeft', 'Escape'])
      break
    case 'lock':
      chord(['MetaLeft', 'KeyL'])
      break
    case 'desktop':
      chord(['MetaLeft', 'KeyD'])
      break
    case 'explorer':
      chord(['MetaLeft', 'KeyE'])
      break
    case 'win':
      chord(['MetaLeft'])
      break
    case 'alttab':
      chord(['AltLeft', 'Tab'])
      break
    case 'altf4':
      chord(['AltLeft', 'F4'])
      break
    case 'prtsc':
      keyEvent(0x2c, true)
      keyEvent(0x2c, false)
      break
  }
}

export { listDisplaysWin }
