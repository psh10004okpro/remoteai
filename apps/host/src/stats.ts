import { execFileSync } from 'node:child_process'
import { statfsSync } from 'node:fs'
import os from 'node:os'
import type { DiskStat, HostStats } from '@remoteai/protocol'

let lastIdle = 0
let lastTotal = 0

function cpuPct() {
  let idle = 0
  let total = 0
  for (const c of os.cpus()) {
    const t = c.times
    idle += t.idle
    total += t.user + t.nice + t.sys + t.idle + t.irq
  }
  const di = idle - lastIdle
  const dt = total - lastTotal
  lastIdle = idle
  lastTotal = total
  if (dt <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((1 - di / dt) * 100)))
}

function disks(): DiskStat[] {
  const mounts = process.platform === 'win32' ? ['C:\\', 'D:\\', 'E:\\', 'F:\\'] : ['/']
  const out: DiskStat[] = []
  for (const mount of mounts) {
    try {
      const s = statfsSync(mount)
      const total = Number(s.blocks) * Number(s.bsize)
      const free = Number(s.bavail) * Number(s.bsize)
      if (total <= 0) continue
      out.push({ mount: process.platform === 'win32' ? mount.slice(0, 2) : mount, used: total - free, total })
    } catch {
      /* missing drive */
    }
  }
  return out
}

function ips() {
  const out: string[] = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.internal || n.family !== 'IPv4') continue
      if (n.address.startsWith('169.254.')) continue
      out.push(n.address)
    }
  }
  return out.slice(0, 4)
}

let tempAt = 0
let cpuTempC: number | null = null
let gpuTempC: number | null = null
let gpuName: string | null = null
let gpuUtilPct: number | null = null

function run(cmd: string, args: string[]) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 2500, windowsHide: true }).trim()
  } catch {
    return ''
  }
}

function readTemps() {
  if (Date.now() - tempAt < 8000) return
  tempAt = Date.now()
  gpuTempC = null
  cpuTempC = null
  gpuName = null
  gpuUtilPct = null
  const nvs = run('nvidia-smi', [
    '--query-gpu=name,temperature.gpu,utilization.gpu',
    '--format=csv,noheader,nounits',
  ])
  const line = (nvs.split(/\r?\n/)[0] || '').split(',').map((s) => s.trim())
  if (line[0]) gpuName = line[0]
  const gpuN = parseInt(line[1] || '', 10)
  if (Number.isFinite(gpuN) && gpuN > 0 && gpuN < 120) gpuTempC = gpuN
  const util = parseInt(line[2] || '', 10)
  if (Number.isFinite(util) && util >= 0 && util <= 100) gpuUtilPct = util
  if (process.platform === 'win32') {
    const raw = run('powershell.exe', [
      '-NoProfile',
      '-Command',
      '$t = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty CurrentTemperature; if ($t) { [int]($t/10 - 273.15) }',
    ])
    const n = parseInt(raw, 10)
    if (Number.isFinite(n) && n > 10 && n < 110) cpuTempC = n
  } else if (process.platform === 'darwin') {
    const raw = run('osx-cpu-temp', [])
    const n = parseFloat(raw)
    if (Number.isFinite(n) && n > 10 && n < 110) cpuTempC = Math.round(n)
  }
}

export function collectStats(): HostStats {
  const memTotal = os.totalmem()
  const memUsed = memTotal - os.freemem()
  readTemps()
  const cpus = os.cpus()
  return {
    hostname: os.hostname(),
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    uptimeSec: Math.round(os.uptime()),
    cpuPct: cpuPct(),
    cpuModel: cpus[0]?.model?.replace(/\s+/g, ' ').trim(),
    cpuCores: cpus.length,
    memUsed,
    memTotal,
    disks: disks(),
    ips: ips(),
    cpuTempC,
    gpuTempC,
    gpuName,
    gpuUtilPct,
  }
}
