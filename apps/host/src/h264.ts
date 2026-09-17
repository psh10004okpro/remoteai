import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { BINARY } from '@remoteai/protocol'
import { log } from './log.js'

let proc: ChildProcessWithoutNullStreams | null = null

export function encodeH264Frame(nal: Buffer, key: boolean) {
  const out = Buffer.alloc(2 + nal.length)
  out[0] = BINARY.H264
  out[1] = key ? 1 : 0
  nal.copy(out, 2)
  return out
}

export function startH264(onFrame: (buf: Buffer) => void) {
  stopH264()
  const p = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'gdigrab',
      '-framerate',
      '15',
      '-i',
      'desktop',
      '-vf',
      'scale=1280:-2',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-tune',
      'zerolatency',
      '-profile:v',
      'baseline',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '15',
      '-bf',
      '0',
      '-f',
      'h264',
      'pipe:1',
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  proc = p
  let acc = Buffer.alloc(0)
  p.stderr?.on('data', (d) => log('h264', String(d).trim()))
  p.stdout.on('data', (chunk: Buffer) => {
    acc = Buffer.concat([acc, chunk])
    const nals = takeNals(acc)
    acc = nals.rest
    for (const nal of nals.list) {
      const t = nal[0] & 0x1f
      onFrame(encodeH264Frame(nal, t === 5 || t === 7 || t === 8))
    }
  })
  p.on('error', (e) => {
    log('h264 ffmpeg missing', e)
    proc = null
  })
  p.on('exit', () => {
    if (proc === p) proc = null
  })
  return p
}

export function stopH264() {
  proc?.kill()
  proc = null
}

export function h264Running() {
  return !!proc
}

function takeNals(buf: Buffer) {
  const list: Buffer[] = []
  let i = 0
  const starts: number[] = []
  while (i < buf.length - 3) {
    if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 0 && buf[i + 3] === 1) {
      starts.push(i)
      i += 4
      continue
    }
    if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) {
      starts.push(i)
      i += 3
      continue
    }
    i++
  }
  if (starts.length < 2) return { list, rest: buf }
  for (let s = 0; s < starts.length - 1; s++) {
    const a = starts[s]
    const b = starts[s + 1]
    const sc = buf[a + 2] === 1 ? 3 : 4
    const nal = buf.subarray(a + sc, b)
    if (nal.length) list.push(Buffer.from(nal))
  }
  const last = starts[starts.length - 1]
  return { list, rest: buf.subarray(last) }
}
