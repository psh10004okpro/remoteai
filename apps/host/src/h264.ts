import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { BINARY } from '@remoteai/protocol'
import { ffmpegBin } from './ffmpeg.js'
import { log } from './log.js'

let proc: ChildProcessWithoutNullStreams | null = null
let stopping = false

export function encodeH264Frame(nal: Buffer, key: boolean) {
  const out = Buffer.alloc(2 + nal.length)
  out[0] = BINARY.H264
  out[1] = key ? 1 : 0
  nal.copy(out, 2)
  return out
}

function encoderList() {
  try {
    const r = spawnSync(ffmpegBin(), ['-hide_banner', '-encoders'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000,
    })
    return `${r.stdout || ''}\n${r.stderr || ''}`
  } catch {
    return ''
  }
}

function pipelines(width: number) {
  const w = Math.max(640, Math.min(1920, width))
  const vf = `scale=${w}:-2`
  const grab =
    process.platform === 'darwin'
      ? ['-f', 'avfoundation', '-framerate', '20', '-i', '1:none']
      : ['-f', 'gdigrab', '-framerate', '20', '-draw_mouse', '1', '-i', 'desktop']
  const dda =
    process.platform === 'win32'
      ? ['-f', 'lavfi', '-i', 'ddagrab=framerate=20,hwdownload,format=bgra', '-vf', vf]
      : null
  const text = encoderList()
  const out: { name: string; args: string[] }[] = []
  const tail = (codec: string, extra: string[]) => [
    '-an',
    '-c:v',
    codec,
    ...extra,
    '-pix_fmt',
    'yuv420p',
    '-g',
    '20',
    '-bf',
    '0',
    '-f',
    'h264',
    'pipe:1',
  ]
  if (/\bh264_nvenc\b/.test(text)) {
    const nv = tail('h264_nvenc', ['-preset', 'p1', '-tune', 'll', '-profile:v', 'baseline', '-b:v', '5M'])
    if (dda) out.push({ name: 'ddagrab+nvenc', args: ['-hide_banner', '-loglevel', 'error', ...dda, ...nv] })
    out.push({ name: 'gdigrab+nvenc', args: ['-hide_banner', '-loglevel', 'error', ...grab, '-vf', vf, ...nv] })
  }
  if (/\bh264_qsv\b/.test(text)) {
    out.push({
      name: 'gdigrab+qsv',
      args: ['-hide_banner', '-loglevel', 'error', ...grab, '-vf', vf, ...tail('h264_qsv', ['-preset', 'veryfast', '-profile:v', 'baseline'])],
    })
  }
  if (/\bh264_amf\b/.test(text)) {
    out.push({
      name: 'gdigrab+amf',
      args: ['-hide_banner', '-loglevel', 'error', ...grab, '-vf', vf, ...tail('h264_amf', ['-quality', 'speed', '-profile:v', 'constrained_baseline'])],
    })
  }
  out.push({
    name: 'gdigrab+x264',
    args: [
      '-hide_banner',
      '-loglevel',
      'error',
      ...grab,
      '-vf',
      vf,
      ...tail('libx264', ['-preset', 'ultrafast', '-tune', 'zerolatency', '-profile:v', 'baseline']),
    ],
  })
  return out
}

export function startH264(onFrame: (buf: Buffer) => void, onFail?: (err: string) => void, maxWidth = 1280) {
  stopH264()
  stopping = false
  const list = pipelines(maxWidth)
  let i = 0
  const tryOne = () => {
    if (stopping) return
    if (i >= list.length) {
      proc = null
      onFail?.('H.264를 시작할 수 없어 JPEG로 보냅니다.')
      return
    }
    const spec = list[i++]
    log('h264 try', spec.name)
    acc = Buffer.alloc(0)
    let sps: Buffer | null = null
    let pps: Buffer | null = null
    let got = false
    const p = spawn(ffmpegBin(), spec.args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    proc = p
    const timer = setTimeout(() => {
      if (!got && proc === p) {
        log('h264 timeout', spec.name)
        p.kill()
      }
    }, 5000)
    p.stderr?.on('data', (d) => log('h264', spec.name, String(d).trim().slice(0, 300)))
    p.stdout.on('data', (chunk: Buffer) => {
      got = true
      clearTimeout(timer)
      accPush(chunk, (nal, key) => onFrame(encodeH264Frame(nal, key)), () => sps, () => pps, (s) => { sps = s }, (s) => { pps = s })
    })
    p.on('error', (e) => {
      log('h264 spawn', spec.name, e)
      clearTimeout(timer)
      if (proc === p) proc = null
      tryOne()
    })
    p.on('exit', () => {
      clearTimeout(timer)
      if (proc === p) proc = null
      if (stopping) return
      if (!got) tryOne()
      else onFail?.('H.264가 중단되어 JPEG로 전환합니다.')
    })
  }
  tryOne()
}

let acc = Buffer.alloc(0)
function accPush(
  chunk: Buffer,
  emit: (nal: Buffer, key: boolean) => void,
  getSps: () => Buffer | null,
  getPps: () => Buffer | null,
  setSps: (b: Buffer) => void,
  setPps: (b: Buffer) => void,
) {
  acc = Buffer.concat([acc, chunk])
  const nals = takeNals(acc)
  acc = nals.rest
  for (const nal of nals.list) {
    const t = nal[0] & 0x1f
    if (t === 7) {
      setSps(Buffer.from(nal))
      continue
    }
    if (t === 8) {
      setPps(Buffer.from(nal))
      continue
    }
    const key = t === 5
    const sps = getSps()
    const pps = getPps()
    const payload = key && sps && pps ? Buffer.concat([sps, Buffer.from([0, 0, 0, 1]), pps, Buffer.from([0, 0, 0, 1]), nal]) : nal
    emit(payload, key)
  }
}

export function stopH264() {
  stopping = true
  proc?.kill()
  proc = null
  acc = Buffer.alloc(0)
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
