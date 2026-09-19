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

export type DeviceInfo = { id: string; name: string; online: boolean; lastSeen: number; mac?: string | null }

export function setPendingSession(deviceId: string) {
  sessionStorage.setItem('remoteai.connect', deviceId)
}

export function takePendingSession() {
  return sessionStorage.getItem('remoteai.connect') || ''
}

export function clearPendingSession() {
  sessionStorage.removeItem('remoteai.connect')
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const r = await fetch(path, { ...init, headers })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) {
    const err = new Error((body as { error?: string }).error || r.statusText) as Error & { status: number }
    err.status = r.status
    throw err
  }
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

export async function login(username: string, password: string, totp?: string) {
  const r = await api<{ token?: string; username: string; totpRequired?: boolean }>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, totp }),
  })
  if (r.token) setSession(r.token, r.username)
  return r
}

export async function fetchDevices() {
  return api<{ devices: DeviceInfo[] }>('/api/devices')
}

export async function deleteDevice(id: string) {
  return api<{ ok: boolean }>(`/api/devices/${id}/delete`, { method: 'POST' })
}

export async function changePassword(current: string, next: string) {
  const r = await api<{ ok: boolean; token: string }>('/api/password', {
    method: 'POST',
    body: JSON.stringify({ current, next }),
  })
  if (r.token) localStorage.setItem(TOKEN, r.token)
  return r
}

export async function renameDevice(id: string, name: string) {
  return api<{ ok: boolean; name: string }>(`/api/devices/${id}/rename`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export async function wakeDevice(id: string) {
  const { fetchLocalHost, localHostUrl } = await import('./ws')
  const local = await fetchLocalHost()
  let localOk = false
  if (local) {
    const list = await fetchDevices()
    const d = list.devices.find((x) => x.id === id)
    if (d?.mac) {
      const r = await fetch(localHostUrl() + '/wol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac: d.mac }),
      }).catch(() => null)
      if (r?.ok) localOk = true
    }
  }
  try {
    const hub = await api<{ ok: boolean; via?: string }>(`/api/devices/${id}/wol`, { method: 'POST' })
    return { ok: true as const, via: hub.via || (localOk ? 'local' : undefined) }
  } catch (e) {
    if (localOk) return { ok: true as const, via: 'local' }
    throw e
  }
}
