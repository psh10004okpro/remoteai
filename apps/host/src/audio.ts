import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { encodeAudio } from '@remoteai/protocol'
import { ffmpegBin } from './ffmpeg.js'
import { log } from './log.js'

let proc: ChildProcessWithoutNullStreams | null = null

export function startAudio(send: (b: Uint8Array) => void, onFail?: (err: string) => void) {
  stopAudio()
  const p = spawn(
    ffmpegBin(),
    ['-f', 'wasapi', '-i', 'loopback', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
  )
  proc = p
  p.stdout.on('data', (chunk: Buffer) => send(encodeAudio(chunk)))
  p.on('error', (e) => {
    log('audio ffmpeg missing', e)
    onFail?.('소리를 켤 수 없습니다. 호스트 폴더에 ffmpeg.exe가 필요합니다.')
  })
  p.on('exit', () => {
    if (proc === p) proc = null
  })
}

export function stopAudio() {
  proc?.kill()
  proc = null
}
