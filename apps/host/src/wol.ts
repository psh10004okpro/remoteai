import dgram from 'node:dgram'
import { log } from './log.js'

export function sendMagic(mac: string) {
  const parts = mac.split(/[:\-]/).map((x) => parseInt(x, 16))
  if (parts.length !== 6 || parts.some((n) => Number.isNaN(n))) {
    log('wol bad mac', mac)
    return
  }
  const magic = Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(Buffer.from(parts))])
  const sock = dgram.createSocket('udp4')
  sock.bind(() => {
    sock.setBroadcast(true)
    sock.send(magic, 9, '255.255.255.255', (err) => {
      sock.close()
      if (err) log('wol', err)
      else log('wol sent', mac)
    })
  })
}
