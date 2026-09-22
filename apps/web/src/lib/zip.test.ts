import assert from 'node:assert/strict'
import { test } from 'node:test'
import { zipStore } from './zip.ts'

test('zip sets UTF-8 flag for Korean names', () => {
  const name = '한글폴더/파일.txt'
  const buf = zipStore([{ name, data: new TextEncoder().encode('ok') }])
  const nameBytes = new TextEncoder().encode(name)
  let i = 0
  while (i < buf.length - 4) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
      const flags = buf[i + 6] | (buf[i + 7] << 8)
      assert.equal(flags & 0x800, 0x800)
      const nlen = buf[i + 26] | (buf[i + 27] << 8)
      assert.equal(nlen, nameBytes.length)
      assert.deepEqual(buf.slice(i + 30, i + 30 + nlen), nameBytes)
      return
    }
    i++
  }
  assert.fail('local header not found')
})
