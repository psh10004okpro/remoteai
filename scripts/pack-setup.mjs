import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packed = path.join(root, 'dist', 'RemoteAI-Host', 'app', 'index.js')
if (!existsSync(packed)) {
  console.error('먼저 npm run pack:host')
  process.exit(1)
}

const candidates = [
  process.env.ISCC,
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  'C:\\Program Files (x86)\\Inno Setup 5\\ISCC.exe',
].filter(Boolean)

const iscc = candidates.find((p) => existsSync(p))
if (!iscc) {
  console.error('Inno Setup 이 없습니다. winget install JRSoftware.InnoSetup')
  process.exit(1)
}

const iss = path.join(root, 'scripts', 'remoteai-setup.iss')
const r = spawnSync(iscc, [iss], { cwd: root, stdio: 'inherit', windowsHide: true })
if (r.status !== 0) process.exit(r.status || 1)
console.log('installer', path.join(root, 'dist', 'RemoteAI-Setup.exe'))
