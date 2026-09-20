export function defaultAllowedOrigins(port: number, publicUrl: string) {
  const list = [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'http://127.0.0.1:4173',
    'http://localhost:4173',
  ]
  const pub = publicUrl.replace(/\/$/, '')
  if (pub) list.push(pub)
  list.push('https://remote.unwoldamstudio.com')
  for (const extra of (process.env.CORS_ORIGINS || '').split(',')) {
    const s = extra.trim().replace(/\/$/, '')
    if (s) list.push(s)
  }
  return [...new Set(list)]
}

export function corsAllowOrigin(reqOrigin: string | undefined, allowed: string[]): string | undefined {
  if (!reqOrigin) return undefined
  const o = reqOrigin.replace(/\/$/, '')
  if (allowed.some((a) => a.replace(/\/$/, '') === o)) return o
  return undefined
}

const buckets = new Map<string, { n: number; reset: number }>()

export function rateLimited(key: string, max: number, windowMs: number) {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || now > b.reset) {
    buckets.set(key, { n: 1, reset: now + windowMs })
    return false
  }
  b.n += 1
  return b.n > max
}

export function resetRateLimits() {
  buckets.clear()
}

export function clientKey(ip: string, extra = '') {
  return `${ip || 'unknown'}:${extra}`
}

export function isLoopbackHostname(host: string) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

export function localApiOriginOk(origin: string, serverUrl: string) {
  if (!origin) return true
  try {
    const u = new URL(origin)
    if (isLoopbackHostname(u.hostname)) return true
    const hub = new URL(serverUrl)
    return u.origin === hub.origin
  } catch {
    return false
  }
}
