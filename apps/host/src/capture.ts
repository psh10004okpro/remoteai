import sharp from 'sharp'
import { encodeJpegFrame } from '@remoteai/protocol'
import type { DisplayInfo, QualitySettings } from '@remoteai/protocol'
import { log } from './log.js'

const win = process.platform === 'win32' ? await import('./win32.js') : null

let screenshots: typeof import('node-screenshots') | null = null
try {
  screenshots = await import('node-screenshots')
} catch (e) {
  log('node-screenshots unavailable, using GDI', String(e))
}

export function listDisplays(): DisplayInfo[] {
  if (screenshots) {
    return screenshots.Monitor.all().map((m, i) => ({
      id: i,
      name: m.name() || (m.isPrimary() ? '주 화면' : `화면 ${i + 1}`),
      x: m.x(),
      y: m.y(),
      width: m.width(),
      height: m.height(),
      primary: m.isPrimary(),
      scaleFactor: m.scaleFactor(),
    }))
  }
  return win?.listDisplaysWin() || []
}

function drawCursor(rgba: Buffer, width: number, height: number, originX: number, originY: number) {
  const pt = win?.cursorPos() || { x: -1, y: -1 }
  const cx = Math.round(pt.x - originX)
  const cy = Math.round(pt.y - originY)
  if (cx < 0 || cy < 0 || cx >= width || cy >= height) return
  for (let i = 0; i < 16; i++) {
    const x = cx
    const y = cy + i
    if (y >= height) break
    const maxX = Math.min(i < 12 ? i : 16 - i, width - x - 1)
    for (let dx = 0; dx <= Math.max(0, maxX); dx++) {
      const o = (y * width + x + dx) * 4
      rgba[o] = 255
      rgba[o + 1] = 255
      rgba[o + 2] = 255
      rgba[o + 3] = 255
      if (dx === 0 || dx === maxX || i === 0) {
        rgba[o] = 20
        rgba[o + 1] = 20
        rgba[o + 2] = 20
      }
    }
  }
}

async function jpegFromRgba(rgba: Buffer, width: number, height: number, quality: QualitySettings) {
  let img = sharp(rgba, { raw: { width, height, channels: 4 } })
  if (width > quality.maxWidth) {
    img = img.resize({ width: quality.maxWidth, withoutEnlargement: true })
  }
  const { info, data } = await img.jpeg({ quality: quality.jpegQuality, mozjpeg: false }).toBuffer({ resolveWithObject: true })
  return { jpeg: data, width: info.width, height: info.height }
}

export async function captureFrame(displayId: number, quality: QualitySettings) {
  const displays = listDisplays()
  const d = displays[displayId] || displays.find((x) => x.primary) || displays[0]
  if (!d) return null

  if (screenshots) {
    try {
      const monitors = screenshots.Monitor.all()
      const m = monitors[displayId] || monitors.find((x) => x.isPrimary()) || monitors[0]
      if (m) {
        const image = m.captureImageSync()
        const raw = image.toRawSync()
        drawCursor(raw, image.width, image.height, m.x(), m.y())
        const { jpeg, width, height } = await jpegFromRgba(raw, image.width, image.height, quality)
        return encodeJpegFrame(displayId, width, height, jpeg)
      }
    } catch (e) {
      log('dxgi capture failed, gdi', e)
    }
  }

  const bgra = win?.captureGdiBgra(d.x, d.y, d.width, d.height)
  if (!bgra) return null
  const rgba = Buffer.alloc(bgra.length)
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2]
    rgba[i + 1] = bgra[i + 1]
    rgba[i + 2] = bgra[i]
    rgba[i + 3] = 255
  }
  drawCursor(rgba, d.width, d.height, d.x, d.y)
  const { jpeg, width, height } = await jpegFromRgba(rgba, d.width, d.height, quality)
  return encodeJpegFrame(displayId, width, height, jpeg)
}

export async function captureJpegBase64(displayId: number, quality: QualitySettings) {
  const frame = await captureFrame(displayId, quality)
  if (!frame) return null
  return Buffer.from(frame.subarray(6)).toString('base64')
}
