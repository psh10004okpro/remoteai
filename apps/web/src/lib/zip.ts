function crcTable() {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
}
const CRC = crcTable()

function crc32(buf: Uint8Array) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function u16(n: number) {
  const b = new Uint8Array(2)
  b[0] = n & 0xff
  b[1] = (n >> 8) & 0xff
  return b
}
function u32(n: number) {
  const b = new Uint8Array(4)
  b[0] = n & 0xff
  b[1] = (n >> 8) & 0xff
  b[2] = (n >> 16) & 0xff
  b[3] = (n >> 24) & 0xff
  return b
}

export function zipStore(files: { name: string; data: Uint8Array }[]) {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = new TextEncoder().encode(f.name.replace(/\\/g, '/'))
    const crc = crc32(f.data)
    const local = [
      u32(0x04034b50),
      u16(20),
      u16(0x800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(f.data.length),
      u32(f.data.length),
      u16(name.length),
      u16(0),
      name,
      f.data,
    ]
    const localBuf = concat(local)
    locals.push(localBuf)
    const central = [
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(f.data.length),
      u32(f.data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]
    centrals.push(concat(central))
    offset += localBuf.length
  }
  const central = concat(centrals)
  const eocd = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ])
  return concat([...locals, central, eocd])
}

function concat(parts: Uint8Array[]) {
  const n = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export function downloadBlob(name: string, data: Blob | Uint8Array) {
  const blob = data instanceof Blob ? data : new Blob([data])
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}
