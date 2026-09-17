import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { encodeAudio } from '@remoteai/protocol'
import { log } from './log.js'

let proc: ChildProcessWithoutNullStreams | null = null

export function startAudio(send: (b: Uint8Array) => void) {
  stopAudio()
  const p = spawn(
    'ffmpeg',
    ['-f', 'wasapi', '-i', 'loopback', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
  )
  proc = p
  p.stdout.on('data', (chunk: Buffer) => send(encodeAudio(chunk)))
  p.on('error', (e) => log('audio ffmpeg missing', e))
  p.on('exit', () => {
    if (proc === p) proc = null
  })
}

export function stopAudio() {
  proc?.kill()
  proc = null
}
