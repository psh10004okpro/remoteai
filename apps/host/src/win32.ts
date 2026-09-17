import koffi from 'koffi'
import { log } from './log.js'

export const user32 = koffi.load('user32.dll')
export const gdi32 = koffi.load('gdi32.dll')
export const kernel32 = koffi.load('kernel32.dll')
export const shell32 = koffi.load('shell32.dll')

try {
  const shcore = koffi.load('shcore.dll')
  const SetProcessDpiAwareness = shcore.func('long __stdcall SetProcessDpiAwareness(int)')
  SetProcessDpiAwareness(2)
} catch {
  try {
    const SetProcessDPIAware = user32.func('bool __stdcall SetProcessDPIAware()')
    SetProcessDPIAware()
  } catch {
    /* ignore */
  }
}

const POINT = koffi.struct('POINT', { x: 'long', y: 'long' })
const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' })
const MONITORINFOEXW = koffi.struct('MONITORINFOEXW', {
  cbSize: 'uint32',
  rcMonitor: RECT,
  rcWork: RECT,
  dwFlags: 'uint32',
  szDevice: koffi.array('uint16', 32),
})

export const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int)')
export const GetCursorPos = user32.func('bool __stdcall GetCursorPos(_Out_ POINT *)')
export const SetCursorPos = user32.func('bool __stdcall SetCursorPos(int, int)')
const mouse_event = user32.func('void __stdcall mouse_event(uint32, uint32, uint32, uint32, uintptr)')
const keybd_event = user32.func('void __stdcall keybd_event(uint8, uint8, uint32, uintptr)')
const SendInput = user32.func('uint __stdcall SendInput(uint, void *, int)')
const MapVirtualKeyW = user32.func('uint __stdcall MapVirtualKeyW(uint, uint)')
export const GetClipboardSequenceNumber = user32.func('uint32 __stdcall GetClipboardSequenceNumber()')
const OpenClipboard = user32.func('bool __stdcall OpenClipboard(void *)')
const CloseClipboard = user32.func('bool __stdcall CloseClipboard()')
const EmptyClipboard = user32.func('bool __stdcall EmptyClipboard()')
const GetClipboardData = user32.func('void * __stdcall GetClipboardData(uint)')
const SetClipboardData = user32.func('void * __stdcall SetClipboardData(uint, void *)')
const IsClipboardFormatAvailable = user32.func('bool __stdcall IsClipboardFormatAvailable(uint)')
const GlobalAlloc = kernel32.func('void * __stdcall GlobalAlloc(uint, uintptr)')
const GlobalLock = kernel32.func('void * __stdcall GlobalLock(void *)')
const GlobalUnlock = kernel32.func('bool __stdcall GlobalUnlock(void *)')
const GlobalSize = kernel32.func('uintptr __stdcall GlobalSize(void *)')
const DragQueryFileW = shell32.func('uint __stdcall DragQueryFileW(void *, uint, void *, uint)')
const EnumWindows = user32.func('bool __stdcall EnumWindows(void *, intptr)')
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void *, void *, int)')
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void *)')
const GetForegroundWindow = user32.func('void * __stdcall GetForegroundWindow()')
const GetWindowTextLengthW = user32.func('int __stdcall GetWindowTextLengthW(void *)')
const EnumDisplayMonitors = user32.func('bool __stdcall EnumDisplayMonitors(void *, void *, void *, intptr)')
const GetMonitorInfoW = user32.func('bool __stdcall GetMonitorInfoW(void *, void *)')
const MonitorFromPoint = user32.func('void * __stdcall MonitorFromPoint(POINT, uint)')
const BlockInput = user32.func('bool __stdcall BlockInput(bool)')
const GetDC = user32.func('void * __stdcall GetDC(void *)')
const ReleaseDC = user32.func('int __stdcall ReleaseDC(void *, void *)')
const CreateCompatibleDC = gdi32.func('void * __stdcall CreateCompatibleDC(void *)')
const CreateCompatibleBitmap = gdi32.func('void * __stdcall CreateCompatibleBitmap(void *, int, int)')
const SelectObject = gdi32.func('void * __stdcall SelectObject(void *, void *)')
const BitBlt = gdi32.func('bool __stdcall BitBlt(void *, int, int, int, int, void *, int, int, uint32)')
const DeleteObject = gdi32.func('bool __stdcall DeleteObject(void *)')
const DeleteDC = gdi32.func('bool __stdcall DeleteDC(void *)')
const GetDIBits = gdi32.func('int __stdcall GetDIBits(void *, void *, uint, uint, void *, void *, uint)')

const SM_XVIRTUALSCREEN = 76
const SM_YVIRTUALSCREEN = 77
const SM_CXVIRTUALSCREEN = 78
const SM_CYVIRTUALSCREEN = 79
const MOUSEEVENTF_MOVE = 0x0001
const MOUSEEVENTF_LEFTDOWN = 0x0002
const MOUSEEVENTF_LEFTUP = 0x0004
const MOUSEEVENTF_RIGHTDOWN = 0x0008
const MOUSEEVENTF_RIGHTUP = 0x0010
const MOUSEEVENTF_MIDDLEDOWN = 0x0020
const MOUSEEVENTF_MIDDLEUP = 0x0040
const MOUSEEVENTF_WHEEL = 0x0800
const MOUSEEVENTF_ABSOLUTE = 0x8000
const MOUSEEVENTF_VIRTUALDESK = 0x4000
const KEYEVENTF_KEYUP = 0x0002
const KEYEVENTF_UNICODE = 0x0004
const KEYEVENTF_EXTENDEDKEY = 0x0001
const CF_UNICODETEXT = 13
const CF_HDROP = 15
const GMEM_MOVEABLE = 0x0002
const MONITORINFOF_PRIMARY = 1
const SRCCOPY = 0x00cc0020
const DIB_RGB_COLORS = 0

export type DisplayRect = {
  id: number
  name: string
  x: number
  y: number
  width: number
  height: number
  primary: boolean
  scaleFactor: number
}

export function virtualScreen() {
  return {
    x: GetSystemMetrics(SM_XVIRTUALSCREEN),
    y: GetSystemMetrics(SM_YVIRTUALSCREEN),
    width: GetSystemMetrics(SM_CXVIRTUALSCREEN),
    height: GetSystemMetrics(SM_CYVIRTUALSCREEN),
  }
}

export function listDisplaysWin(): DisplayRect[] {
  const out: DisplayRect[] = []
  const MonitorEnumProc = koffi.proto('int __stdcall MonitorEnumProc(void *h, void *hdc, RECT *rc, intptr lp)')
  const cb = koffi.register((h: unknown) => {
    const infoBuf = Buffer.alloc(104)
    infoBuf.writeUInt32LE(104, 0)
    const ok = GetMonitorInfoW(h, infoBuf)
    if (!ok) return 1
    const left = infoBuf.readInt32LE(4)
    const top = infoBuf.readInt32LE(8)
    const right = infoBuf.readInt32LE(12)
    const bottom = infoBuf.readInt32LE(16)
    const flags = infoBuf.readUInt32LE(36)
    const nameChars: string[] = []
    for (let i = 0; i < 32; i++) {
      const c = infoBuf.readUInt16LE(40 + i * 2)
      if (!c) break
      nameChars.push(String.fromCharCode(c))
    }
    out.push({
      id: out.length,
      name: nameChars.join('') || `화면 ${out.length + 1}`,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      primary: (flags & MONITORINFOF_PRIMARY) !== 0,
      scaleFactor: 1,
    })
    return 1
  }, koffi.pointer(MonitorEnumProc))
  EnumDisplayMonitors(null, null, cb, 0)
  koffi.unregister(cb)
  if (!out.length) {
    const v = virtualScreen()
    out.push({ id: 0, name: '화면 1', ...v, primary: true, scaleFactor: 1 })
  }
  return out
}

export function cursorPos() {
  const pt = { x: 0, y: 0 }
  GetCursorPos(pt)
  return pt
}

export function moveMouseAbs(x: number, y: number) {
  const v = virtualScreen()
  const ax = Math.round(((x - v.x) / Math.max(1, v.width - 1)) * 65535)
  const ay = Math.round(((y - v.y) / Math.max(1, v.height - 1)) * 65535)
  mouse_event(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, ax >>> 0, ay >>> 0, 0, 0)
}

export function mouseButton(button: number, down: boolean) {
  const map: Record<number, [number, number]> = {
    0: [MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP],
    1: [MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP],
    2: [MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP],
  }
  const pair = map[button] || map[0]
  mouse_event(down ? pair[0] : pair[1], 0, 0, 0, 0)
}

export function mouseWheel(dy: number) {
  mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (Math.round(-dy * 120) >>> 0), 0)
}

const EXTENDED = new Set([
  0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2d, 0x2e, 0x5b, 0x5c, 0xa3, 0xa5,
])

export function keyEvent(vk: number, down: boolean) {
  const scan = MapVirtualKeyW(vk, 0)
  let flags = down ? 0 : KEYEVENTF_KEYUP
  if (EXTENDED.has(vk)) flags |= KEYEVENTF_EXTENDEDKEY
  keybd_event(vk & 0xff, scan & 0xff, flags, 0)
}

export function sendUnicode(text: string) {
  const INPUT_KEYBOARD = 1
  const size = 40
  for (const ch of text) {
    const code = ch.codePointAt(0) || 0
    if (code > 0xffff) continue
    for (const up of [false, true]) {
      const buf = Buffer.alloc(size)
      buf.writeUInt32LE(INPUT_KEYBOARD, 0)
      buf.writeUInt16LE(0, 8)
      buf.writeUInt16LE(code, 10)
      buf.writeUInt32LE(KEYEVENTF_UNICODE | (up ? KEYEVENTF_KEYUP : 0), 12)
      SendInput(1, buf, size)
    }
  }
}

function openClip(retries = 8) {
  for (let i = 0; i < retries; i++) {
    if (OpenClipboard(null)) return true
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
  }
  return false
}

export function readClipboardText(): string | null {
  if (!IsClipboardFormatAvailable(CF_UNICODETEXT)) return null
  if (!openClip()) return null
  try {
    const h = GetClipboardData(CF_UNICODETEXT)
    if (!h) return null
    const ptr = GlobalLock(h)
    if (!ptr) return null
    try {
      const n = Number(GlobalSize(h))
      const buf = koffi.decode(ptr, koffi.array('uint8', n)) as number[]
      const u16 = Buffer.from(buf)
      let s = u16.toString('utf16le')
      const z = s.indexOf('\u0000')
      if (z >= 0) s = s.slice(0, z)
      return s
    } finally {
      GlobalUnlock(h)
    }
  } catch (e) {
    log('readClipboardText', e)
    return null
  } finally {
    CloseClipboard()
  }
}

export function writeClipboardText(text: string) {
  const u16 = Buffer.from(text + '\u0000', 'utf16le')
  const h = GlobalAlloc(GMEM_MOVEABLE, u16.length)
  const ptr = GlobalLock(h)
  koffi.encode(ptr, koffi.array('uint8', u16.length), Array.from(u16))
  GlobalUnlock(h)
  if (!openClip()) return false
  try {
    EmptyClipboard()
    SetClipboardData(CF_UNICODETEXT, h)
    return true
  } finally {
    CloseClipboard()
  }
}

export function readClipboardFiles(): string[] {
  if (!IsClipboardFormatAvailable(CF_HDROP)) return []
  if (!openClip()) return []
  try {
    const h = GetClipboardData(CF_HDROP)
    if (!h) return []
    const count = DragQueryFileW(h, 0xffffffff, null, 0)
    const files: string[] = []
    for (let i = 0; i < count; i++) {
      const chars = DragQueryFileW(h, i, null, 0)
      const buf = Buffer.alloc((chars + 1) * 2)
      DragQueryFileW(h, i, buf, chars + 1)
      files.push(buf.toString('utf16le').replace(/\u0000+$/, ''))
    }
    return files
  } catch (e) {
    log('readClipboardFiles', e)
    return []
  } finally {
    CloseClipboard()
  }
}

export function writeClipboardFiles(paths: string[]) {
  const joined = paths.join('\u0000') + '\u0000\u0000'
  const body = Buffer.from(joined, 'utf16le')
  const headerSize = 20
  const h = GlobalAlloc(GMEM_MOVEABLE, headerSize + body.length)
  const ptr = GlobalLock(h)
  const header = Buffer.alloc(headerSize)
  header.writeUInt32LE(headerSize, 0)
  header.writeInt32LE(0, 4)
  header.writeInt32LE(0, 8)
  header.writeInt32LE(0, 12)
  header.writeInt32LE(1, 16)
  const bytes = Buffer.concat([header, body])
  koffi.encode(ptr, koffi.array('uint8', bytes.length), [...bytes])
  GlobalUnlock(h)
  if (!openClip()) return false
  try {
    EmptyClipboard()
    SetClipboardData(CF_HDROP, h)
    return true
  } finally {
    CloseClipboard()
  }
}

export function listWindowTitles(): string[] {
  const titles: string[] = []
  const EnumProc = koffi.proto('int __stdcall EnumProc(void *hwnd, intptr lp)')
  const cb = koffi.register((hwnd: unknown) => {
    if (!IsWindowVisible(hwnd)) return 1
    const len = GetWindowTextLengthW(hwnd)
    if (len <= 0) return 1
    const buf = Buffer.alloc((len + 1) * 2)
    GetWindowTextW(hwnd, buf, len + 1)
    const t = buf.toString('utf16le').replace(/\u0000+$/, '')
    if (t) titles.push(t)
    return 1
  }, koffi.pointer(EnumProc))
  EnumWindows(cb, 0)
  koffi.unregister(cb)
  return titles.slice(0, 80)
}

export function captureGdiBgra(x: number, y: number, width: number, height: number): Buffer | null {
  const hdc = GetDC(null)
  const mem = CreateCompatibleDC(hdc)
  const bmp = CreateCompatibleBitmap(hdc, width, height)
  const old = SelectObject(mem, bmp)
  const ok = BitBlt(mem, 0, 0, width, height, hdc, x, y, SRCCOPY)
  if (!ok) {
    SelectObject(mem, old)
    DeleteObject(bmp)
    DeleteDC(mem)
    ReleaseDC(null, hdc)
    return null
  }
  const header = Buffer.alloc(44)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(width, 4)
  header.writeInt32LE(-height, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  const stride = width * 4
  const bits = Buffer.alloc(stride * height)
  const n = GetDIBits(hdc, bmp, 0, height, bits, header, DIB_RGB_COLORS)
  SelectObject(mem, old)
  DeleteObject(bmp)
  DeleteDC(mem)
  ReleaseDC(null, hdc)
  if (!n) return null
  return bits
}

export function trySendSas() {
  try {
    const sas = koffi.load('sas.dll')
    const SendSAS = sas.func('void __stdcall SendSAS(int)')
    SendSAS(0)
    return true
  } catch {
    return false
  }
}

export { BlockInput, RECT, POINT, MonitorFromPoint, GetForegroundWindow, SendInput }
