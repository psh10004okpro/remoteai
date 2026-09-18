import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { BINARY } from '@remoteai/protocol'
import { ffmpegBin } from './ffmpeg.js'
import { log } from './log.js'

let proc: ChildProcessWithoutNullStreams | null = null

export function encodeH264Frame(nal: Buffer, key: boolean) {
  const out = Buffer.alloc(2 + nal.length)
  out[0] = BINARY.H264
  out[1] = key ? 1 : 0
  nal.copy(out, 2)
  return out
}

export function startH264(onFrame: (buf: Buffer) => void, onFail?: (err: string) => void, maxWidth = 1280) {
  stopH264()
  const w = Math.max(640, Math.min(1920, Math.round(maxWidth) || 1280))
  let sps: Buffer | null = null
  let pps: Buffer | null = null
  const p = spawn(
    ffmpegBin(),
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
      `scale=${w}:-2`,
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
      if (t === 7) {
        sps = Buffer.from(nal)
        continue
      }
      if (t === 8) {
        pps = Buffer.from(nal)
        continue
      }
      const key = t === 5
      const payload = key && sps && pps ? Buffer.concat([sps, Buffer.from([0, 0, 0, 1]), pps, Buffer.from([0, 0, 0, 1]), nal]) : nal
      onFrame(encodeH264Frame(payload, key))
    }
  })
  p.on('error', (e) => {
    log('h264 ffmpeg missing', e)
    proc = null
    onFail?.('H.264를 시작할 수 없어 JPEG로 보냅니다. 호스트 폴더에 ffmpeg.exe가 필요합니다.')
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
