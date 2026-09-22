export const PROTOCOL_VERSION = 1
export const DEFAULT_PORT = 18790
export const HOST_LOCAL_PORT = 18791
export const WS_PATH = '/ws'
export const MAX_AUTO_CLIPBOARD_BYTES = 50 * 1024 * 1024
export const FILE_CHUNK_SIZE = 64 * 1024

export const BINARY = {
  JPEG: 1,
  FILE: 2,
  PTY: 3,
  AUDIO: 4,
  H264: 5,
} as const

export type BinaryKind = (typeof BINARY)[keyof typeof BINARY]

export type DisplayInfo = {
  id: number
  name: string
  x: number
  y: number
  width: number
  height: number
  primary: boolean
  scaleFactor: number
}

export type Capabilities = {
  clipboardText: boolean
  clipboardFiles: boolean
  fileTransfer: boolean
  dragDrop: boolean
  terminal: boolean
  ssh: boolean
  ai: boolean
  blankScreen: boolean
  wol: boolean
  specialKeys: boolean
  multiMonitor: boolean
  audio: boolean
  viewOnly: boolean
}

export const DEFAULT_CAPABILITIES: Capabilities = {
  clipboardText: true,
  clipboardFiles: true,
  fileTransfer: true,
  dragDrop: true,
  terminal: true,
  ssh: true,
  ai: true,
  blankScreen: true,
  wol: true,
  specialKeys: true,
  multiMonitor: true,
  audio: true,
  viewOnly: true,
}

export type FileEntry = {
  name: string
  path: string
  dir: boolean
  size: number
  mtime: number
}

export type QualitySettings = {
  fps: number
  jpegQuality: number
  maxWidth: number
}

export const DEFAULT_QUALITY: QualitySettings = {
  fps: 18,
  jpegQuality: 60,
  maxWidth: 1600,
}

export type DiskStat = { mount: string; used: number; total: number }

export type HostStats = {
  hostname: string
  os: string
  arch: string
  uptimeSec: number
  cpuPct: number
  cpuModel?: string
  cpuCores?: number
  memUsed: number
  memTotal: number
  disks: DiskStat[]
  ips?: string[]
  cpuTempC?: number | null
  gpuTempC?: number | null
  gpuName?: string | null
  gpuUtilPct?: number | null
}

export type SpecialKey =
  | 'cad'
  | 'taskmgr'
  | 'lock'
  | 'desktop'
  | 'explorer'
  | 'win'
  | 'alttab'
  | 'altf4'
  | 'prtsc'

export type Msg =
  | { type: 'host.hello'; protocol: number; name: string; os: string; mac?: string; token?: string; deviceId?: string; accountToken?: string; accountUser?: string; displays: DisplayInfo[]; capabilities: Capabilities }
  | { type: 'host.welcome'; deviceId: string; token: string; accountUser?: string }
  | { type: 'host.error'; message: string }
  | { type: 'account.unlinked' }
  | { type: 'viewer.auth'; deviceId: string; password?: string; accountToken?: string }
  | { type: 'viewer.welcome'; deviceId: string; name: string; displays: DisplayInfo[]; capabilities: Capabilities; quality: QualitySettings }
  | { type: 'viewer.denied'; message: string }
  | { type: 'session.end'; reason: string }
  | { type: 'input.mouse'; action: 'move' | 'down' | 'up' | 'wheel'; nx?: number; ny?: number; button?: number; dy?: number; displayId: number }
  | { type: 'input.key'; action: 'down' | 'up'; code: string; key: string; ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean }
  | { type: 'input.text'; text: string }
  | { type: 'input.special'; key: SpecialKey }
  | { type: 'display.select'; displayId: number }
  | { type: 'display.list'; displays: DisplayInfo[] }
  | { type: 'quality.set'; quality: Partial<QualitySettings> }
  | { type: 'session.viewOnly'; on: boolean }
  | { type: 'session.fit'; width: number; height: number }
  | { type: 'file.progress'; transferId: number; sent: number; total: number }
  | { type: 'audio.toggle'; on: boolean }
  | { type: 'quality.auto'; on: boolean }
  | { type: 'webrtc.offer'; sdp: string }
  | { type: 'webrtc.answer'; sdp: string }
  | { type: 'webrtc.ice'; candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null }
  | { type: 'webrtc.failed' }
  | { type: 'media.ack'; codec: 'h264' | 'jpeg' }
  | { type: 'clipboard.text'; text: string; origin: 'host' | 'viewer' }
  | { type: 'clipboard.files.offer'; origin: 'host' | 'viewer'; batchId: string; files: { name: string; size: number; relativePath: string }[] }
  | { type: 'clipboard.files.accept' }
  | { type: 'clipboard.files.complete'; origin: 'host' | 'viewer'; batchId: string }
  | { type: 'file.list'; path: string }
  | { type: 'file.listResult'; path: string; entries: FileEntry[]; error?: string }
  | { type: 'file.get'; path: string }
  | { type: 'file.start'; transferId: number; name: string; size: number; relativePath: string; toPath?: string; origin: 'host' | 'viewer'; batchId?: string }
  | { type: 'file.end'; transferId: number; savedPath?: string; batchId?: string; origin?: 'host' | 'viewer' }
  | { type: 'file.abort'; transferId: number; error?: string }
  | { type: 'chat'; from: 'host' | 'viewer' | 'system'; text: string }
  | { type: 'ai.user'; text: string }
  | { type: 'ai.assistant'; text: string }
  | { type: 'ai.status'; text: string }
  | { type: 'ai.error'; message: string }
  | { type: 'ai.tool'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'ai.toolResult'; id: string; ok: boolean; text?: string; imageJpegBase64?: string }
  | { type: 'term.open' }
  | { type: 'term.data'; data: string }
  | { type: 'term.resize'; cols: number; rows: number }
  | { type: 'term.close' }
  | { type: 'privacy.blank'; on: boolean }
  | { type: 'host.lock' }
  | { type: 'wol.request'; mac: string }
  | { type: 'ping'; t: number }
  | { type: 'pong'; t: number }
  | { type: 'oneTime.create' }
  | { type: 'oneTime.code'; code: string; expiresAt: number }
  | { type: 'viewer.authCode'; code: string }
  | { type: 'viewer.count'; n: number }
  | { type: 'host.stats'; stats: HostStats }

export function encodeJpegFrame(
  displayId: number,
  width: number,
  height: number,
  jpeg: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(6 + jpeg.length)
  out[0] = BINARY.JPEG
  out[1] = displayId & 0xff
  out[2] = width & 0xff
  out[3] = (width >> 8) & 0xff
  out[4] = height & 0xff
  out[5] = (height >> 8) & 0xff
  out.set(jpeg, 6)
  return out
}

export function decodeJpegFrame(buf: Uint8Array): {
  displayId: number
  width: number
  height: number
  jpeg: Uint8Array
} | null {
  if (buf.length < 7 || buf[0] !== BINARY.JPEG) return null
  return {
    displayId: buf[1],
    width: buf[2] | (buf[3] << 8),
    height: buf[4] | (buf[5] << 8),
    jpeg: buf.subarray(6),
  }
}

export function encodeFileChunk(
  transferId: number,
  seq: number,
  last: boolean,
  chunk: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(10 + chunk.length)
  out[0] = BINARY.FILE
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  view.setUint32(1, transferId, true)
  view.setUint32(5, seq, true)
  out[9] = last ? 1 : 0
  out.set(chunk, 10)
  return out
}

export function decodeFileChunk(buf: Uint8Array): {
  transferId: number
  seq: number
  last: boolean
  chunk: Uint8Array
} | null {
  if (buf.length < 11 || buf[0] !== BINARY.FILE) return null
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  return {
    transferId: view.getUint32(1, true),
    seq: view.getUint32(5, true),
    last: buf[9] === 1,
    chunk: buf.subarray(10),
  }
}

export function encodePty(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + bytes.length)
  out[0] = BINARY.PTY
  out.set(bytes, 1)
  return out
}

export function decodePty(buf: Uint8Array): Uint8Array | null {
  if (buf.length < 2 || buf[0] !== BINARY.PTY) return null
  return buf.subarray(1)
}

export function encodeAudio(pcm: Uint8Array) {
  const out = new Uint8Array(1 + pcm.length)
  out[0] = BINARY.AUDIO
  out.set(pcm, 1)
  return out
}

export function decodeAudio(buf: Uint8Array) {
  if (buf.length < 2 || buf[0] !== BINARY.AUDIO) return null
  return buf.subarray(1)
}

export function formatDeviceId(id: string): string {
  const d = id.replace(/\D/g, '').padStart(9, '0').slice(0, 9)
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 9)}`
}

export function parseDeviceId(input: string): string {
  return input.replace(/\D/g, '').slice(0, 9)
}

export function generateDeviceId(): string {
  const n = Math.floor(100_000_000 + Math.random() * 900_000_000)
  return String(n)
}

export function generatePin(): string {
  const n = Math.floor(1000_0000 + Math.random() * 9000_0000)
  return String(n)
}
