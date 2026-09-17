import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fetchLocalHost, localHostUrl, type LocalHostInfo } from '../lib/ws'
import {
  api,
  clearSession,
  fetchDevices,
  getToken,
  getUser,
  login,
  renameDevice,
  setPendingSession,
  signup,
  wakeDevice,
  type DeviceInfo,
} from '../lib/auth'

function ago(ts: number) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return '방금'
  if (s < 3600) return `${Math.floor(s / 60)}분 전`
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`
  return `${Math.floor(s / 86400)}일 전`
}

export default function Home() {
  const nav = useNavigate()
  const [user, setUser] = useState(getUser())
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [needTotp, setNeedTotp] = useState(false)
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [tab, setTab] = useState<'access' | 'support'>('access')
  const [err, setErr] = useState('')
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [local, setLocal] = useState<LocalHostInfo | null>(null)
  const [code, setCode] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  async function refresh() {
    const loc = await fetchLocalHost()
    setLocal(loc)
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
    } catch (e) {
      if ((e as { status?: number }).status === 401) {
        clearSession()
        setUser('')
        setDevices([])
      }
    }
  }

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 8000)
    return () => clearInterval(t)
  }, [])

  async function onAuth(e: FormEvent) {
    e.preventDefault()
    setErr('')
    try {
      if (mode === 'signup') {
        await signup(username, password)
        setUser(getUser())
      } else {
        const r = await login(username, password, totp || undefined)
        if (r.totpRequired && !r.token) {
          setNeedTotp(true)
          return
        }
        setUser(getUser())
      }
      setPassword('')
      setTotp('')
      setNeedTotp(false)
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  function connectDevice(id: string) {
    setPendingSession(id)
    nav('/session')
  }

  return (
    <div className="page">
      <div className="top">
        <div className="brand">
          <img className="logo" src="/logo.svg" alt="" />
          <div>
            <h1>RemoteAI</h1>
            <p className="tag">내 컴퓨터에, 브라우저만으로.</p>
          </div>
        </div>
        <nav className="nav">
          <Link to="/host">이 컴퓨터</Link>
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
            {needTotp && (
              <>
                <label>인증 앱 코드</label>
                <input value={totp} onChange={(e) => setTotp(e.target.value)} inputMode="numeric" autoComplete="one-time-code" />
              </>
            )}
            {err && <p className="hint" style={{ color: 'var(--danger)' }}>{err}</p>}
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn" type="submit">
                {mode === 'signup' ? '가입하고 시작' : '로그인'}
              </button>
              <button className="btn ghost" type="button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
                {mode === 'login' ? '회원가입' : '이미 계정이 있습니다'}
              </button>
            </div>
          </form>
          <div className="card">
            <h2>지원 코드로 접속</h2>
            <p className="hint">다른 사람이 보여 준 6자리 코드로 한 번만 들어갑니다.</p>
            <label>일회용 코드</label>
            <div className="row">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
              <button className="btn" type="button" onClick={() => code && nav(`/session?code=${encodeURIComponent(code)}`)}>
                접속
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="tabs">
            <button type="button" className={tab === 'access' ? 'on' : ''} onClick={() => setTab('access')}>
              내 컴퓨터
            </button>
            <button type="button" className={tab === 'support' ? 'on' : ''} onClick={() => setTab('support')}>
              지원
            </button>
          </div>
          {tab === 'access' ? (
            <div className="grid">
              <div>
                <h2 style={{ margin: '0 0 4px' }}>{user}의 컴퓨터</h2>
                <p className="hint">온라인인 기기를 누르면 들어갑니다.</p>
                {devices.length === 0 && (
                  <div className="card" style={{ marginTop: 12 }}>
                    <p className="hint">아직 등록된 컴퓨터가 없습니다. 이 PC에서 호스트를 실행하고 같은 아이디로 연결하세요.</p>
                    <Link to="/host">이 컴퓨터 설정</Link>
                  </div>
                )}
                {devices.map((d) => (
                  <div key={d.id} className="device-card">
                    <span className={'dot' + (d.online ? '' : ' off')} />
                    <div className="grow">
                      {editing === d.id ? (
                        <form
                          className="row"
                          onSubmit={async (e) => {
                            e.preventDefault()
                            await renameDevice(d.id, editName)
                            setEditing(null)
                            await refresh()
                          }}
                        >
                          <input className="grow" value={editName} onChange={(e) => setEditName(e.target.value)} />
                          <button className="btn" type="submit">저장</button>
                        </form>
                      ) : (
                        <>
                          <h3>{d.name}{local?.deviceId === d.id ? ' · 이 컴퓨터' : ''}</h3>
                          <div className="meta">{d.online ? '온라인' : '오프라인'} · {ago(d.lastSeen)}</div>
                        </>
                      )}
                    </div>
                    <button className="btn ghost" type="button" onClick={() => { setEditing(d.id); setEditName(d.name) }}>
                      이름
                    </button>
                    {!d.online && d.mac && (
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={async () => {
                          try {
                            await wakeDevice(d.id)
                          } catch (e) {
                            setErr(e instanceof Error ? e.message : String(e))
                          }
                        }}
                      >
                        켜기
                      </button>
                    )}
                    <button className="btn" type="button" disabled={!d.online} onClick={() => connectDevice(d.id)}>
                      접속
                    </button>
                  </div>
                ))}
              </div>
              <div className="card">
                <h2>이 컴퓨터</h2>
                <TwoFactor />
                {local ? (
                  <>
                    <span className={'pill' + (local.online ? '' : ' off')}>
                      {local.accountUser ? '공유 중' : local.online ? '호스트 실행 중' : '오프라인'}
                    </span>
                    <p className="hint" style={{ marginTop: 10 }}>{local.hostname}</p>
                    <Link className="btn" to="/host">설정</Link>
                  </>
                ) : (
                  <p className="hint">이 PC를 원격 대상으로 쓰려면 호스트를 실행하세요.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="card">
              <h2>원격 지원</h2>
              <p className="hint">일회용 코드로 다른 사람의 PC에 들어가거나, 이 PC를 잠시 열어 줍니다.</p>
              <label>접속할 코드</label>
              <div className="row">
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
                <button className="btn" type="button" onClick={() => code && nav(`/session?code=${encodeURIComponent(code)}`)}>
                  접속
                </button>
              </div>
              {local && (
                <p className="hint" style={{ marginTop: 16 }}>
                  코드를 만들려면 <Link to="/host">이 컴퓨터 설정</Link>에서 일회용 접속 코드를 누르세요.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function TwoFactor() {
  const [on, setOn] = useState(false)
  const [secret, setSecret] = useState('')
  const [otpauthUrl, setOtpauth] = useState('')
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => {
    api<{ totpEnabled?: boolean }>('/api/me')
      .then((r) => setOn(!!r.totpEnabled))
      .catch(() => undefined)
  }, [])
  return (
    <details className="adv" style={{ marginBottom: 12 }}>
      <summary>2단계 인증</summary>
      {on ? (
        <>
          <p className="hint">켜져 있습니다. 로그인 때 인증 앱 코드가 필요합니다.</p>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="끌 때 앱 코드" />
          <button
            className="btn ghost"
            type="button"
            onClick={async () => {
              await api('/api/2fa/disable', { method: 'POST', body: JSON.stringify({ code }) })
              setOn(false)
              setSecret('')
              setMsg('2단계 인증을 껐습니다.')
            }}
          >
            끄기
          </button>
        </>
      ) : (
        <>
          <button
            className="btn ghost"
            type="button"
            onClick={async () => {
              const r = await api<{ secret: string; otpauth: string }>('/api/2fa/setup', { method: 'POST' })
              setSecret(r.secret)
              setOtpauth(r.otpauth)
              setMsg('QR을 찍거나 시크릿을 인증 앱에 넣은 뒤 코드를 입력하세요.')
            }}
          >
            설정 시작
          </button>
          {secret && (
            <>
              {otpauthUrl && (
                <img
                  alt="2FA QR"
                  width={180}
                  height={180}
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(otpauthUrl)}`}
                />
              )}
              <p className="hint" style={{ wordBreak: 'break-all' }}>{secret}</p>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6자리" />
              <button
                className="btn"
                type="button"
                onClick={async () => {
                  await api('/api/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) })
                  setOn(true)
                  setMsg('2단계 인증이 켜졌습니다.')
                }}
              >
                사용
              </button>
            </>
          )}
          {msg && <p className="hint">{msg}</p>}
        </>
      )}
    </details>
  )
}
