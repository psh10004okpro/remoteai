import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'

export type DeviceRecord = {
  id: string
  tokenHash: string
  name: string
  lastSeen: number
  mac?: string
  username?: string
  nameIsCustom?: boolean
}

export type UserRecord = {
  username: string
  passwordHash: string
  sessions: { tokenHash: string; created: number }[]
  totpSecret?: string
  totpEnabled?: boolean
}

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data')
const deviceFile = path.join(dataDir, 'devices.json')
const userFile = path.join(dataDir, 'users.json')

let devices = new Map<string, DeviceRecord>()
let users = new Map<string, UserRecord>()

export async function loadStore() {
  await mkdir(dataDir, { recursive: true })
  try {
    const list = JSON.parse(await readFile(deviceFile, 'utf8')) as DeviceRecord[]
    devices = new Map(list.map((d) => [d.id, d]))
  } catch {
    devices = new Map()
  }
  try {
    const list = JSON.parse(await readFile(userFile, 'utf8')) as UserRecord[]
    users = new Map(list.map((u) => [u.username.toLowerCase(), u]))
  } catch {
    users = new Map()
  }
}

async function saveDevices() {
  await mkdir(dataDir, { recursive: true })
  await writeFile(deviceFile, JSON.stringify([...devices.values()], null, 2))
}

async function saveUsers() {
  await mkdir(dataDir, { recursive: true })
  await writeFile(userFile, JSON.stringify([...users.values()], null, 2))
}

export function hashSecret(secret: string, salt: string) {
  return scryptSync(secret, salt, 32).toString('hex')
}

export function hashToken(id: string, token: string) {
  return hashSecret(token, `remoteai:${id}`)
}

export function newToken() {
  return randomBytes(24).toString('base64url')
}

function sameHash(hexA: string, hexB: string) {
  const a = Buffer.from(hexA, 'hex')
  const b = Buffer.from(hexB, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export function upsertDevice(rec: DeviceRecord) {
  devices.set(rec.id, rec)
  void saveDevices()
}

export function getDevice(id: string) {
  return devices.get(id)
}

export function verifyToken(id: string, token: string) {
  const rec = devices.get(id)
  if (!rec) return false
  return sameHash(rec.tokenHash, hashToken(id, token))
}

export function listDevicesForUser(username: string) {
  const u = username.toLowerCase()
  return [...devices.values()].filter((d) => (d.username || '').toLowerCase() === u)
}

export function createUser(username: string, password: string) {
  const key = username.toLowerCase()
  if (users.has(key)) return { ok: false as const, error: '이미 있는 아이디입니다.' }
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    return { ok: false as const, error: '아이디는 3~32자 영문·숫자·._- 만 가능합니다.' }
  }
  if (password.length < 6) return { ok: false as const, error: '비밀번호는 6자 이상이어야 합니다.' }
  const rec: UserRecord = {
    username,
    passwordHash: hashSecret(password, `user:${key}`),
    sessions: [],
  }
  users.set(key, rec)
  void saveUsers()
  return { ok: true as const, user: rec }
}

export function issueSession(rec: UserRecord) {
  const token = newToken()
  rec.sessions.push({ tokenHash: hashSecret(token, `sess:${rec.username.toLowerCase()}`), created: Date.now() })
  rec.sessions = rec.sessions.slice(-8)
  users.set(rec.username.toLowerCase(), rec)
  void saveUsers()
  return token
}

export function loginUser(username: string, password: string) {
  const key = username.toLowerCase()
  const rec = users.get(key)
  if (!rec) return { ok: false as const, error: '아이디 또는 비밀번호가 올바르지 않습니다.' }
  if (!sameHash(rec.passwordHash, hashSecret(password, `user:${key}`))) {
    return { ok: false as const, error: '아이디 또는 비밀번호가 올바르지 않습니다.' }
  }
  if (rec.totpEnabled) return { ok: true as const, totpRequired: true as const, username: rec.username }
  const token = issueSession(rec)
  return { ok: true as const, token, username: rec.username, totpRequired: false as const }
}

export function getUserRecord(username: string) {
  return users.get(username.toLowerCase()) || null
}

export function saveUser(rec: UserRecord) {
  users.set(rec.username.toLowerCase(), rec)
  void saveUsers()
}

export function renameDevice(id: string, username: string, name: string) {
  const rec = devices.get(id)
  if (!rec || (rec.username || '').toLowerCase() !== username.toLowerCase()) return false
  rec.name = name.slice(0, 64).trim() || rec.name
  rec.nameIsCustom = true
  upsertDevice(rec)
  return true
}

export function userFromSession(token: string | undefined | null) {
  if (!token) return null
  for (const rec of users.values()) {
    const want = hashSecret(token, `sess:${rec.username.toLowerCase()}`)
    if (rec.sessions.some((s) => sameHash(s.tokenHash, want))) return rec
  }
  return null
}

export function logoutSession(token: string) {
  for (const rec of users.values()) {
    const want = hashSecret(token, `sess:${rec.username.toLowerCase()}`)
    const next = rec.sessions.filter((s) => !sameHash(s.tokenHash, want))
    if (next.length !== rec.sessions.length) {
      rec.sessions = next
      void saveUsers()
      return
    }
  }
}
