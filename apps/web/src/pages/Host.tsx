import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDeviceId } from '@remoteai/protocol'
import { fetchLocalHost, fetchLocalPin, HOST_SETUP_MAC_URL, HOST_SETUP_URL, localHostUrl, type LocalHostInfo } from '../lib/ws'

export default function Host() {
  const [info, setInfo] = useState<LocalHostInfo | null>(null)
  const [show, setShow] = useState(false)
  const [err, setErr] = useState('')
  const [accUser, setAccUser] = useState('')
  const [accPass, setAccPass] = useState('')
  const [accTotp, setAccTotp] = useState('')
  const [needTotp, setNeedTotp] = useState(false)
  const [serverUrl, setServerUrl] = useState('')
  const [hubMode, setHubMode] = useState<boolean | null>(null)

  async function refresh() {
    const v = await fetchLocalHost()
    if (!v) {
      setInfo(null)
      setErr('이 컴퓨터에서만 호스트 설정을 볼 수 있습니다. 호스트 에이전트가 켜져 있는지 확인하세요.')
      return
    }
    const pin = await fetchLocalPin().catch(() => '')
    setInfo({ ...v, password: pin || v.password || '' })
    setErr('')
    setServerUrl(v.serverUrl)
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
          <Link to="/features">기능</Link>
        </nav>
      </div>
      {err && (
        <p className="hint">
          {err}{' '}
          <a href={HOST_SETUP_URL}>Windows 설치</a>
          {' · '}
          <a href={HOST_SETUP_MAC_URL}>Mac 설치</a>
        </p>
      )}
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
          {needTotp && (
            <>
              <label>인증 앱 코드 또는 복구 코드</label>
              <input value={accTotp} onChange={(e) => setAccTotp(e.target.value)} autoComplete="one-time-code" />
            </>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="btn"
              type="button"
              onClick={async () => {
                const r = await fetch(localHostUrl() + '/login', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ username: accUser, password: accPass, totp: accTotp || undefined }),
                })
                const body = await r.json()
                if (body.totpRequired && !body.ok) {
                  setNeedTotp(true)
                  setErr(body.error || '인증 앱 코드 또는 복구 코드를 입력하세요.')
                } else if (!body.ok) setErr(body.error || '로그인 실패')
                else {
                  setErr('')
                  setAccPass('')
                  setAccTotp('')
                  setNeedTotp(false)
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
          <HostUpdate info={info} onBusy={setErr} />
        </div>
      )}
    </div>
  )
}

function newerThan(latest: string, current: string) {
  const a = latest.split('.').map((n) => parseInt(n, 10) || 0)
  const b = current.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true
    if ((a[i] || 0) < (b[i] || 0)) return false
  }
  return false
}

function HostUpdate({ info, onBusy }: { info: LocalHostInfo; onBusy: (s: string) => void }) {
  const [latest, setLatest] = useState(info.update?.latest || '')
  const [available, setAvailable] = useState(!!(info.update?.available && !info.update?.snoozed))
  const [busy, setBusy] = useState('')
  async function check() {
    const r = await fetch(localHostUrl() + '/check-update', { method: 'POST' })
    const b = (await r.json()) as { update?: LocalHostInfo['update'] }
    const u = b.update
    setLatest(u?.latest || '')
    setAvailable(!!(u?.available && !u?.snoozed))
    if (u?.available && !u.snoozed) onBusy(`새 버전 ${u.latest}이 있습니다. 지금 올리거나 그대로 쓸 수 있습니다.`)
    else onBusy(`최신입니다. (${u?.current || info.version})`)
  }
  const hasNew = available || (latest && info.version && newerThan(latest, info.version) && !info.update?.snoozed)
  return (
    <div style={{ marginTop: 20 }}>
      <h2>이 컴퓨터 프로그램</h2>
      {hasNew && (
        <p className="hint" style={{ color: 'var(--accent, #5eead4)' }}>
          새 버전 {latest}이 있습니다. 지금은 그대로 써도 되고, 올리면 PIN·계정은 유지된 채 다시 붙습니다.
        </p>
      )}
      <p className="hint">
        설치 버전 {info.version || '알 수 없음'}
        {latest ? ` · 최신 ${latest}` : ''}
      </p>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn ghost" type="button" disabled={!!busy} onClick={() => void check()}>
          업데이트 확인
        </button>
        <button
          className="btn"
          type="button"
          disabled={!!busy}
          onClick={async () => {
            if (!confirm('업데이트하면 호스트가 잠깐 꺼졌다가, 같은 설정으로 다시 연결됩니다. 계속할까요?')) return
            setBusy('update')
            onBusy('설치 파일을 받는 중입니다. 끝나면 호스트가 자동으로 다시 켜집니다.')
            try {
              const r = await fetch(localHostUrl() + '/update', { method: 'POST' })
              const b = await r.json().catch(() => ({}))
              onBusy((b as { message?: string }).message || '업데이트를 시작했습니다.')
            } catch (e) {
              onBusy(e instanceof Error ? e.message : String(e))
            }
            setBusy('')
          }}
        >
          지금 업데이트
        </button>
        {hasNew && (
          <button
            className="btn ghost"
            type="button"
            disabled={!!busy}
            onClick={async () => {
              await fetch(localHostUrl() + '/snooze-update', { method: 'POST' })
              setAvailable(false)
              onBusy('지금은 그대로 씁니다. 7일 뒤 또는 다음 확인 때 다시 알려 드립니다.')
            }}
          >
            나중에 · 그대로 사용
          </button>
        )}
        <button
          className="btn ghost"
          type="button"
          disabled={!!busy}
          onClick={async () => {
            if (!confirm('이 컴퓨터에서 RemoteAI 호스트를 제거할까요?')) return
            setBusy('uninstall')
            try {
              await fetch(localHostUrl() + '/uninstall', { method: 'POST' })
              onBusy('제거를 시작했습니다.')
            } catch (e) {
              onBusy(e instanceof Error ? e.message : String(e))
            }
            setBusy('')
          }}
        >
          이 컴퓨터에서 삭제
        </button>
      </div>
    </div>
  )
}
