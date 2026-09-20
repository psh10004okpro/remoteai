import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { recentHubLogs, type HubLog } from './hub-log.js'

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data')

export type OpsSnapshot = {
  startedAt: string
  version: number
  publicUrl: string | null
  turn: boolean
  xai: boolean
  rooms: { deviceId: string; name: string; host: boolean; viewers: number; viewOnly: boolean }[]
  devices: { id: string; name: string; online: boolean; lastSeen: number }[]
  username: string
}

function tailAudit(limit: number, username: string) {
  try {
    const raw = readFileSync(path.join(dataDir, 'audit.jsonl'), 'utf8')
    const lines = raw.trim().split('\n').filter(Boolean)
    const mine = lines.filter((l) => l.includes(username) || !/"username"/.test(l))
    return mine.slice(-limit).map((l) => {
      try {
        return JSON.parse(l) as Record<string, unknown>
      } catch {
        return { raw: l.slice(0, 200) }
      }
    })
  } catch {
    return []
  }
}

export function buildOpsReport(snap: OpsSnapshot) {
  const logs = recentHubLogs(200)
  const errors = recentHubLogs(50, 'error')
  const audit = tailAudit(80, snap.username)
  const json = {
    generatedAt: new Date().toISOString(),
    uptimeSec: Math.round((Date.now() - Date.parse(snap.startedAt)) / 1000),
    version: snap.version,
    publicUrl: snap.publicUrl,
    flags: { turn: snap.turn, xai: snap.xai },
    rooms: snap.rooms,
    devices: snap.devices,
    audit,
    errors,
    logs: logs.slice(-100),
  }
  const prompt = [
    'RemoteAI 진단 리포트다. 너는 이 저장소의 엔지니어로, 아래 JSON만 근거로 원인·수정 파일·개선 순서를 한국어로 짧게 제안하라.',
    '비밀값(비밀번호, 토큰, TOTP)은 없다. 없으면 없다고 쓰고, 추측이면 추측이라고 밝혀라.',
    '우선 고칠 결함, 그다음 사용성, 마지막에 운영 개선 순으로.',
    '',
    '```json',
    JSON.stringify(json, null, 2),
    '```',
  ].join('\n')
  return { prompt, json }
}

export function filterLogs(limit: number, level?: HubLog['level']) {
  return recentHubLogs(limit, level)
}
