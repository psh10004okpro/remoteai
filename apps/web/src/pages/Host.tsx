import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDeviceId } from '@remoteai/protocol'
import { fetchLocalHost, localHostUrl, type LocalHostInfo } from '../lib/ws'

export default function Host() {
  const [info, setInfo] = useState<LocalHostInfo | null>(null)
  const [show, setShow] = useState(false)
  const [err, setErr] = useState('')
  const [accUser, setAccUser] = useState('')
  const [accPass, setAccPass] = useState('')
  const [serverUrl, setServerUrl] = useState('')
  const [hubMode, setHubMode] = useState<boolean | null>(null)

  async function refresh() {
    const v = await fetchLocalHost()
    setInfo(v)
    if (!v) setErr('이 컴퓨터에서만 호스트 설정을 볼 수 있습니다. 호스트 에이전트가 켜져 있는지 확인하세요.')
    else {
      setErr('')
      setServerUrl(v.serverUrl)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function patch(body: Partial<LocalHostInfo>) {
    await fetch(localHostUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    await refresh()
  }

  return (
    <div className="page">
      <div className="top">
        <div className="brand">
          <img className="logo" src="/logo.svg" alt="" />
          <div>
            <h1>이 컴퓨터 설정</h1>
            <p className="tag">계정으로 공유 · 부팅 시 시작 · SSH</p>
          </div>
        </div>
        <nav className="nav">
          <Link to="/">접속</Link>
        </nav>
      </div>
      {err && <p className="hint">{err}</p>}
      {info && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>계정 서버</h2>
          <p className="hint">
            Chrome 원격처럼 여러 PC가 서로 들어가려면 <strong>계정·기기 목록을 한곳</strong>에 둬야 합니다. 항상 켜 두는
            PC(또는 VPS)가 그 서버가 됩니다.
          </p>
          <div className="toggle">
            <input
              id="hub"
              type="checkbox"
              checked={hubMode ?? !!info.hub}
              onChange={(e) => {
                setHubMode(e.target.checked)
                if (e.target.checked) patch({ serverUrl: 'http://127.0.0.1:18790' })
              }}
            />
            <label htmlFor="hub" style={{ margin: 0 }}>
              이 컴퓨터가 계정 서버입니다 (회원가입 데이터가 여기에 저장됩니다)
            </label>
          </div>
          {(hubMode ?? !!info.hub) ? (
            <p className="hint">
              다른 PC 호스트 설정에 아래 주소를 넣으세요. 웹도 이 주소로 여세요.
              {(info.hubUrls || []).map((u) => (
                <span key={u}>
                  <br />
                  <code>{u}</code>
                </span>
              ))}
              {(info.hubUrls || []).length === 0 && (
                <>
                  <br />
                  <code>http://이-PC의-IP:18790</code>
                </>
              )}
              <br />
              인터넷에서 쓰려면 이 포트(18790)를 공유기에서 열거나 Cloudflare Tunnel로 노출하면 됩니다.
            </p>
          ) : (
            <>
              <label>계정 서버 주소</label>
              <div className="row">
                <input
                  className="grow"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="http://192.168.0.10:18790"
                />
                <button className="btn" type="button" onClick={() => patch({ serverUrl })}>
                  저장
                </button>
              </div>
              <p className="hint">계정 서버가 돌아가는 PC의 주소입니다. 이 PC는 호스트만 실행하고 그 서버에 붙습니다.</p>
            </>
          )}
        </div>
      )}
      {info && !info.accountUser && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>계정 로그인</h2>
          <p className="hint">회원가입한 아이디로 로그인하면 이 PC가 내 컴퓨터 목록에 올라가고, 다른 내 PC에서 들어올 수 있습니다.</p>
          <label>아이디</label>
          <input value={accUser} onChange={(e) => setAccUser(e.target.value)} />
          <label>비밀번호</label>
          <input type="password" value={accPass} onChange={(e) => setAccPass(e.target.value)} />
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="btn"
              type="button"
              onClick={async () => {
                const r = await fetch(localHostUrl() + '/login', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ username: accUser, password: accPass }),
                })
                const body = await r.json()
                if (!body.ok) setErr(body.error || '로그인 실패')
                else {
                  setErr('')
                  setAccPass('')
                  await refresh()
                }
              }}
            >
              이 컴퓨터 계정에 연결
            </button>
          </div>
        </div>
      )}
      {info && (
        <div className="card">
          <span className={'pill' + (info.online ? '' : ' off')}>
            {info.accountUser ? `${info.accountUser} · 공유 중` : info.online ? '서버에 연결됨' : '서버 대기 중'}
          </span>
          {info.accountUser && (
            <button
              className="btn ghost"
              type="button"
              style={{ marginLeft: 8 }}
              onClick={async () => {
                await fetch(localHostUrl() + '/logout', { method: 'POST' })
                await refresh()
              }}
            >
              계정 연결 해제
            </button>
          )}
          <p className="hint" style={{ marginTop: 10 }}>{info.hostname}</p>
          <div className="toggle">
            <input
              id="as"
              type="checkbox"
              checked={info.autoStart}
              onChange={(e) => patch({ autoStart: e.target.checked })}
            />
            <label htmlFor="as" style={{ margin: 0 }}>
              이 컴퓨터 켤 때 호스트 시작
            </label>
          </div>
          <details className="adv">
            <summary>고급: PIN, SSH, 일회용 코드</summary>
            <div className="id-big">{formatDeviceId(info.deviceId || '---------')}</div>
            <div className="row">
              <button className="btn ghost" type="button" onClick={() => navigator.clipboard.writeText(info.deviceId)}>
                ID 복사
              </button>
              <button className="btn ghost" type="button" onClick={() => navigator.clipboard.writeText(info.password)}>
                PIN 복사
              </button>
            </div>
            <label>게스트 PIN</label>
            <div className="row">
              <input
                className="grow"
                type={show ? 'text' : 'password'}
                value={info.password}
                onChange={(e) => setInfo({ ...info, password: e.target.value })}
              />
              <button className="btn ghost" type="button" onClick={() => setShow((s) => !s)}>
                {show ? '숨기기' : '표시'}
              </button>
              <button className="btn" type="button" onClick={() => patch({ password: info.password })}>
                저장
              </button>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button
                className="btn ghost"
                type="button"
                onClick={async () => {
                  await fetch(localHostUrl() + '/onetime', { method: 'POST' })
                  await new Promise((r) => setTimeout(r, 600))
                  await refresh()
                }}
              >
                일회용 접속 코드
              </button>
              {info.oneTime && info.oneTime.expiresAt > Date.now() && (
                <span className="pill">
                  {info.oneTime.code} · {Math.max(0, Math.round((info.oneTime.expiresAt - Date.now()) / 60000))}분
                </span>
              )}
            </div>
            <div className="toggle">
              <input id="ssh" type="checkbox" checked={info.sshLan} onChange={(e) => patch({ sshLan: e.target.checked })} />
              <label htmlFor="ssh" style={{ margin: 0 }}>
                LAN SSH 허용 (포트 2222)
              </label>
            </div>
            <div className="toggle">
              <input
                id="lock"
                type="checkbox"
                checked={info.lockOnDisconnect}
                onChange={(e) => patch({ lockOnDisconnect: e.target.checked })}
              />
              <label htmlFor="lock" style={{ margin: 0 }}>
                마지막 뷰어가 나가면 화면 잠금
              </label>
            </div>
            <p className="hint">
              SSH: <code>ssh -p 2222 {info.username || 'user'}@127.0.0.1</code>
            </p>
          </details>
        </div>
      )}
    </div>
  )
}
