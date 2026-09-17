import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { exec } from 'node:child_process'
import { configDir } from './config.js'
import { formatDeviceId } from '@remoteai/protocol'
import { log } from './log.js'

function writeIcon(dest: string) {
  const w = 16
  const pixels = Buffer.alloc(w * w * 4)
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      pixels[o] = 15
      pixels[o + 1] = 118
      pixels[o + 2] = 110
      pixels[o + 3] = 255
      if (x >= 3 && x <= 7 && y >= 4 && y <= 11) {
        pixels[o] = 255
        pixels[o + 1] = 255
        pixels[o + 2] = 255
      }
      if (x >= 8 && x <= 12 && y >= 4 && y <= 11) {
        pixels[o] = 204
        pixels[o + 1] = 251
        pixels[o + 2] = 241
      }
    }
  }
  const header = Buffer.alloc(6 + 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  header[6] = 16
  header[7] = 16
  header[8] = 0
  header[9] = 0
  header.writeUInt16LE(1, 10)
  header.writeUInt16LE(32, 12)
  header.writeUInt32LE(40 + pixels.length, 14)
  header.writeUInt32LE(6 + 16, 18)
  const dib = Buffer.alloc(40)
  dib.writeUInt32LE(40, 0)
  dib.writeInt32LE(16, 4)
  dib.writeInt32LE(32, 8)
  dib.writeUInt16LE(1, 12)
  dib.writeUInt16LE(32, 14)
  dib.writeUInt32LE(pixels.length, 20)
  const xor = Buffer.alloc(pixels.length)
  for (let y = 0; y < 16; y++) {
    pixels.copy(xor, (15 - y) * 16 * 4, y * 16 * 4, y * 16 * 4 + 64)
  }
  writeFileSync(dest, Buffer.concat([header, dib, xor]))
}

export async function startTray(opts: { deviceId: () => string; password: () => string; openUi: () => void }) {
  try {
    const { default: SysTray } = await import('systray2')
    const icon = path.join(configDir(), 'icon.ico')
    writeIcon(icon)
    const tray = new SysTray({
      menu: {
        icon,
        isTemplateIcon: false,
        title: 'RemoteAI',
        tooltip: 'RemoteAI',
        items: [
          { title: 'RemoteAI', enabled: false, checked: false },
          { title: '대시보드 열기', enabled: true, checked: false },
          { title: 'ID 복사', enabled: true, checked: false },
          { title: '종료', enabled: true, checked: false },
        ],
      },
      debug: false,
      copyDir: true,
    })
    tray.onClick((action: { seq_id: number }) => {
      if (action.seq_id === 1) opts.openUi()
      if (action.seq_id === 2) {
        exec(`cmd /c echo ${formatDeviceId(opts.deviceId())}| clip`)
      }
      if (action.seq_id === 3) {
        tray.kill()
        process.exit(0)
      }
    })
    log('tray started')
  } catch (e) {
    log('tray unavailable', e)
  }
}
