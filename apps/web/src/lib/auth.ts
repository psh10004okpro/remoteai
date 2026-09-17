const TOKEN = 'remoteai.token'
const USER = 'remoteai.user'

export function getToken() {
  return localStorage.getItem(TOKEN) || ''
}

export function getUser() {
  return localStorage.getItem(USER) || ''
}

export function setSession(token: string, username: string) {
  localStorage.setItem(TOKEN, token)
  localStorage.setItem(USER, username)
}

export function clearSession() {
  localStorage.removeItem(TOKEN)
  localStorage.removeItem(USER)
}

export type DeviceInfo = { id: string; name: string; online: boolean; lastSeen: number }

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const r = await fetch(path, { ...init, headers })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((body as { error?: string }).error || r.statusText)
  return body as T
}

export async function signup(username: string, password: string) {
  const r = await api<{ token: string; username: string }>('/api/signup', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  setSession(r.token, r.username)
  return r
}

export async function login(username: string, password: string) {
  const r = await api<{ token: string; username: string }>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  setSession(r.token, r.username)
  return r
}

export async function fetchDevices() {
  return api<{ devices: DeviceInfo[] }>('/api/devices')
}
