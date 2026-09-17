import { createHmac, randomBytes } from 'node:crypto'

const ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function randomSecret() {
  const bytes = randomBytes(20)
  let bits = ''
  for (const b of bytes) bits += b.toString(2).padStart(8, '0')
  let out = ''
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += ALPH[parseInt(bits.slice(i, i + 5), 2)]
  }
  return out
}

function decodeBase32(s: string) {
  const clean = s.replace(/=+$/, '').toUpperCase()
  let bits = ''
  for (const ch of clean) {
    const i = ALPH.indexOf(ch)
    if (i < 0) continue
    bits += i.toString(2).padStart(5, '0')
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

export function totp(secret: string, at = Date.now()) {
  const key = decodeBase32(secret)
  const counter = Math.floor(at / 1000 / 30)
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(0, 0)
  buf.writeUInt32BE(counter, 4)
  const hmac = createHmac('sha1', key).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return String(code).padStart(6, '0')
}

export function totpOk(secret: string, code: string) {
  const c = String(code || '').replace(/\s/g, '')
  const now = Date.now()
  return [-1, 0, 1].some((w) => totp(secret, now + w * 30_000) === c)
}

export function otpauth(username: string, secret: string) {
  return `otpauth://totp/RemoteAI:${encodeURIComponent(username)}?secret=${secret}&issuer=RemoteAI&period=30`
}
