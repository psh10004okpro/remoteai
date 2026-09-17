import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fetchLocalHost, localHostUrl, type LocalHostInfo } from '../lib/ws'
import {
  clearSession,
  fetchDevices,
  getToken,
  getUser,
  login,
  signup,
  type DeviceInfo,
} from '../lib/auth'

export default function Home() {
  const nav = useNavigate()
  const [user, setUser] = useState(getUser())
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [err, setErr] = useState('')
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [local, setLocal] = useState<LocalHostInfo | null>(null)
  const [code, setCode] = useState('')
  const [hubUrls, setHubUrls] = useState<string[]>([])

  async function refresh() {
    const loc = await fetchLocalHost()
    setLocal(loc)
    fetch('/api/health')
      .then((r) => r.json())
      .then((h: { hostUrls?: string[] }) => setHubUrls(h.hostUrls || []))
      .catch(() => undefined)
    if (!getToken()) {
      setDevices([])
      return
    }
    try {
      const r = await fetchDevices()
      setDevices(r.devices)
      setUser(getUser())
      if (loc && getToken()) {
        await fetch(localHostUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountToken: getToken(), accountUser: getUser() }),
        }).catch(() => undefined)
      }
    } catch {
      clearSession()
      setUser('')
      setDevices([])
    }
  }

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 5000)
    return () => clearInterval(t)
  }, [])

  async function onAuth(e: FormEvent) {
    e.preventDefault()
    setErr('')
    try {
      if (mode === 'signup') await signup(username, password)
      else await login(username, password)
      setUser(getUser())
      setPassword('')
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  function connectDevice(id: string) {
    const q = new URLSearchParams({ id, token: getToken() })
    nav(`/session?${q.toString()}`)
  }

  return (
    <div className="page">
      <div className="top">
        <div className="brand">
          <img className="logo" src="/logo.svg" alt="" />
          <div>
            <h1>RemoteAI</h1>
            <p className="tag">Chrome 원격 데스크톱처럼, 내 계정으로 컴퓨터에 들어갑니다.</p>
          </div>
        </div>
        <nav className="nav">
          <Link to="/host">이 컴퓨터</Link>
          <Link to="/features">기능</Link>
          {user && (
            <button
              className="btn ghost"
              type="button"
              onClick={async () => {
                await fetch('/api/logout', { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` } })
                await fetch(localHostUrl() + '/logout', { method: 'POST' }).catch(() => undefined)
                clearSession()
                setUser('')
                setDevices([])
              }}
            >
              로그아웃
            </button>
          )}
        </nav>
      </div>

      {!user ? (
        <div className="grid">
          <form className="card" onSubmit={onAuth}>
            <h2>{mode === 'signup' ? '회원가입' : '로그인'}</h2>
            <p className="hint">
              같은 아이디로 로그인한 컴퓨터끼리는 서로 원격 접속할 수 있습니다. 계정은{' '}
              <strong>지금 이 페이지를 연 서버</strong>에 저장됩니다.
              {hubUrls.length > 0 && (
                <>
                  {' '}
                  다른 PC는 호스트 설정에 <code>{hubUrls[0]}</code> 를 넣으세요.
                </>
              )}
            </p>
            <label>아이디</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
            <label>비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              required
            />
            {err && <p className="hint" style={{ color: 'var(--danger)' }}>{err}</p>}
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn" type="submit">
                {mode === 'signup' ? '가입하고 시작' : '로그인'}
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
              >
                {mode === 'login' ? '회원가입' : '이미 계정이 있습니다'}
              </button>
            </div>
          </form>
          <div className="card">
            <h2>이 컴퓨터</h2>
            {local ? (
              <p className="hint">
                호스트가 실행 중입니다 ({local.hostname}). 로그인하면 이 PC가 계정에 등록되고, 다른 내 컴퓨터에서도 들어올 수
                있습니다.
              </p>
            ) : (
              <p className="hint">이 PC에서 호스트를 켜 두면 원격 대상이 됩니다. <code>npm run dev</code></p>
            )}
            <label>일회용 지원 코드로 접속</label>
            <div className="row">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6자리" />
              <button
                className="btn ghost"
                type="button"
                onClick={() => code && nav(`/session?code=${encodeURIComponent(code)}`)}
              >
                접속
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid">
          <div className="card">
            <h2>내 컴퓨터</h2>
            <p className="hint">{user} 계정 · 온라인인 컴퓨터를 눌러 들어갑니다. 반대쪽 PC에서도 이 목록이 같습니다.</p>
            {devices.length === 0 && (
              <p className="hint">아직 등록된 컴퓨터가 없습니다. 이 컴퓨터에서 호스트를 실행한 뒤 잠시 기다려 주세요.</p>
            )}
            {devices.map((d) => (
              <div key={d.id} className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
                <div>
                  <strong>{d.name}</strong>{' '}
                  <span className={'pill' + (d.online ? '' : ' off')}>{d.online ? '온라인' : '오프라인'}</span>
                  {local?.deviceId === d.id && <span className="hint"> · 이 컴퓨터</span>}
                </div>
                <button
                  className="btn"
                  type="button"
                  disabled={!d.online}
                  onClick={() => connectDevice(d.id)}
                >
                  {local?.deviceId === d.id ? '테스트 접속' : '접속'}
                </button>
              </div>
            ))}
          </div>
          <div className="card">
            <h2>이 컴퓨터</h2>
            {local ? (
              <>
                <span className={'pill' + (local.online ? '' : ' off')}>
                  {local.accountUser ? `${local.accountUser}로 공유 중` : local.online ? '온라인' : '오프라인'}
                </span>
                <p className="hint">
                  {local.hostname}
                  <br />
                  다른 내 컴퓨터에서 이 PC 이름({local.hostname})을 누르면 들어옵니다.
                </p>
                <Link className="btn" to="/host">
                  호스트 설정
                </Link>
              </>
            ) : (
              <p className="hint">이 PC를 원격 대상으로 쓰려면 호스트 프로그램을 실행하세요.</p>
            )}
            <label style={{ marginTop: 16 }}>일회용 지원 코드</label>
            <div className="row">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6자리" />
              <button className="btn ghost" type="button" onClick={() => code && nav(`/session?code=${encodeURIComponent(code)}`)}>
                접속
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
