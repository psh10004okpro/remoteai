import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'darwin') {
  console.error('pack-host-mac 은 macOS에서 실행하세요 (GitHub Actions macos-latest).')
  process.exit(1)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'dist', 'RemoteAI-Mac')
const hostJs = path.join(root, 'apps', 'host', 'dist', 'index.js')
if (!existsSync(hostJs)) {
  console.error('build host first: npm run build -w @remoteai/host')
  process.exit(1)
}

rmSync(out, { recursive: true, force: true })
mkdirSync(path.join(out, 'app'), { recursive: true })
cpSync(hostJs, path.join(out, 'app', 'index.js'))
cpSync(process.execPath, path.join(out, 'node'))

const pkg = {
  name: 'remoteai-host-pack',
  private: true,
  type: 'module',
  dependencies: {
    koffi: '^2.10.1',
    'node-screenshots': '^0.2.8',
    sharp: '^0.33.5',
    'node-pty': '^1.0.0',
    systray2: '^2.1.4',
  },
}
writeFileSync(path.join(out, 'package.json'), JSON.stringify(pkg, null, 2))
const npm = spawnSync('npm', ['install', '--omit=dev'], { cwd: out, stdio: 'inherit' })
if (npm.status !== 0) process.exit(npm.status || 1)

const ffmpeg = spawnSync('which', ['ffmpeg'], { encoding: 'utf8' })
const ff = (ffmpeg.stdout || '').trim()
if (ff && existsSync(ff)) {
  try {
    cpSync(realpathSync(ff), path.join(out, 'ffmpeg'))
  } catch {
    /* skip */
  }
}

writeFileSync(
  path.join(out, 'RemoteAI.command'),
  [
    '#!/bin/bash',
    'cd "$(dirname "$0")"',
    'export REMOTEAI_PACKAGED=1',
    'export REMOTEAI_HOME="$(pwd)"',
    'chmod +x ./node 2>/dev/null',
    './node ./app/index.js "$@"',
    '',
  ].join('\n'),
  { mode: 0o755 },
)

writeFileSync(
  path.join(out, '설치.command'),
  [
    '#!/bin/bash',
    'set -e',
    'SRC="$(cd "$(dirname "$0")" && pwd)"',
    'DEST="$HOME/Applications/RemoteAI"',
    'mkdir -p "$DEST"',
    'rsync -a --delete "$SRC/" "$DEST/" --exclude "설치.command"',
    'chmod +x "$DEST/node" "$DEST/RemoteAI.command"',
    'open "$DEST/RemoteAI.command"',
    'echo "설치했습니다: $DEST"',
    'echo "시스템 설정 → 개인 정보 보호 → 화면 기록 / 손쉬운 사용 에서 RemoteAI(node)를 허용하세요."',
    '',
  ].join('\n'),
  { mode: 0o755 },
)

writeFileSync(
  path.join(out, '설치안내.txt'),
  `RemoteAI 맥 호스트
================

1. 설치.command 를 실행하세요. (처음이면 우클릭 → 열기)
2. 시스템 설정 → 개인 정보 보호 및 보안
   - 화면 기록
   - 손쉬운 사용
   에서 node 또는 RemoteAI 를 켜세요.
3. 브라우저에서 같은 아이디로 로그인하면 이 맥이 목록에 올라갑니다.

로그인 화면 제어는 맥에서 지원하지 않습니다.
접속만 하는 맥/폰은 설치하지 않아도 됩니다.
`,
)

const zip = path.join(root, 'dist', 'RemoteAI-Mac.zip')
rmSync(zip, { force: true })
const ditto = spawnSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', out, zip], { stdio: 'inherit' })
if (ditto.status !== 0) process.exit(ditto.status || 1)
console.log('packed', zip)
