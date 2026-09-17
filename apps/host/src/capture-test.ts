import { writeFileSync } from 'node:fs'
import { captureFrame, listDisplays } from './capture.js'
import { DEFAULT_QUALITY } from '@remoteai/protocol'

const displays = listDisplays()
console.log(displays)
const frame = await captureFrame(displays.find((d) => d.primary)?.id ?? 0, DEFAULT_QUALITY)
if (!frame) {
  console.error('capture failed')
  process.exit(1)
}
writeFileSync('capture-test.jpg', Buffer.from(frame.subarray(6)))
console.log('wrote capture-test.jpg', frame.length)
