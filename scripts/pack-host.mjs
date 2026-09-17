import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'dist', 'RemoteAI-Host')
const hostJs = path.join(root, 'apps', 'host', 'dist', 'index.js')
if (!existsSync(hostJs)) {
  console.error('build host first: npm run build -w @remoteai/host')
  process.exit(1)
}

rmSync(out, { recursive: true, force: true })
mkdirSync(path.join(out, 'app'), { recursive: true })
cpSync(hostJs, path.join(out, 'app', 'index.js'))
cpSync(process.execPath, path.join(out, 'node.exe'))

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
const npm = spawnSync('npm', ['install', '--omit=dev'], { cwd: out, shell: true, stdio: 'inherit' })
if (npm.status !== 0) process.exit(npm.status || 1)

writeFileSync(
  path.join(out, 'RemoteAI.cmd'),
  [
    '@echo off',
    'cd /d "%~dp0"',
    'set REMOTEAI_PACKAGED=1',
    'set REMOTEAI_HOME=%~dp0',
    'start "" "%~dp0node.exe" "%~dp0app\\index.js" %*',
    '',
  ].join('\r\n'),
)

writeFileSync(
  path.join(out, '설치.cmd'),
  ['@echo off', 'cd /d "%~dp0"', 'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"', ''].join('\r\n'),
)

writeFileSync(
  path.join(out, 'install.ps1'),
  `$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $env:LOCALAPPDATA 'Programs\\RemoteAI'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Get-ChildItem $src -Force | Where-Object { $_.Name -notin @('install.ps1','설치.cmd') } | ForEach-Object {
  Copy-Item $_.FullName -Destination $dest -Recurse -Force
}
$cmd = Join-Path $dest 'RemoteAI.cmd'
$w = New-Object -ComObject WScript.Shell
$desk = $w.SpecialFolders('Desktop')
$sc = $w.CreateShortcut((Join-Path $desk 'RemoteAI.lnk'))
$sc.TargetPath = $cmd
$sc.WorkingDirectory = $dest
$sc.Description = 'RemoteAI 호스트'
$sc.Save()
$start = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\RemoteAI.lnk'
$sc2 = $w.CreateShortcut($start)
$sc2.TargetPath = $cmd
$sc2.WorkingDirectory = $dest
$sc2.Save()
Start-Process $cmd
Write-Host '설치했습니다. 브라우저에서 같은 아이디로 로그인하면 이 PC가 목록에 올라갑니다.'
Write-Host $dest
`,
)

writeFileSync(
  path.join(out, '제거.cmd'),
  [
    '@echo off',
    'taskkill /IM node.exe /F >nul 2>&1',
    'reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v RemoteAIHost /f >nul 2>&1',
    'rmdir /s /q "%LOCALAPPDATA%\\Programs\\RemoteAI"',
    'del /q "%USERPROFILE%\\Desktop\\RemoteAI.lnk" >nul 2>&1',
    'del /q "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\RemoteAI.lnk" >nul 2>&1',
    'echo 제거했습니다.',
    'pause',
    '',
  ].join('\r\n'),
)

writeFileSync(
  path.join(out, '설치안내.txt'),
  `RemoteAI 호스트 설치
====================

이 폴더의 "설치.cmd" 를 실행하세요.

- 원격으로 열릴 Windows PC에 설치합니다. (호스트)
- 접속만 하는 폰/다른 PC는 설치하지 않아도 됩니다.
  브라우저에서 아래 주소로 로그인하면 됩니다.
  ${'https://n14di7zep9bvjhkkrk1rlfw9.64.176.227.93.sslip.io'}
- 접속하는 Windows에도 설치하면
  1) 그 PC도 목록에 올라 서로 들어갈 수 있고
  2) 원격 파일을 탐색기에 Ctrl+V 로 붙여넣을 수 있습니다.

같은 아이디로 로그인하세요.
`,
)

console.log('packed', out)
