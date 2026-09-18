import { Link } from 'react-router-dom'

const rows = [
  ['부팅/로그온 후 대기', 'Chrome Remote Desktop, TeamViewer, AnyDesk, ToDesk', '로그온·시작 시 작업 스케줄러 + Run 키. 서버와 호스트를 같이 올림'],
  ['계정 로그인 후 내 컴퓨터 목록', 'Chrome Remote Desktop Google 계정', '회원가입 아이디/비밀번호. 같은 계정 PC끼리 양방향 접속'],
  ['게스트 PIN / 일회용 코드', 'CRD PIN, 지원 코드', '호스트 PIN과 일회용 코드는 계정 없이 지원용으로 유지'],
  ['2단계 인증', 'CRD, TeamViewer', 'TOTP + 복구 코드. QR은 이 브라우저에서 만듦'],
  ['원격→로컬 파일 클립보드', 'TeamViewer 네이티브 클라이언트', '접속 PC에 호스트가 있으면 CF_HDROP로 Ctrl+V. 브라우저만 있으면 zip'],
  ['PC·핸드폰 브라우저', 'CRD, MeshCentral, Guacamole', '설치 없는 웹 뷰어 + PWA'],
  ['양방향 텍스트 클립보드', 'CRD, TeamViewer, AnyDesk', '포함'],
  ['파일/폴더 클립보드', 'TeamViewer, AnyDesk, RemotePC (CRD는 없음)', '포함 — 원격에서 붙여넣기. 바이트 진행률'],
  ['드래그 앤 드롭', 'RemotePC, AnyDesk', '세션 화면으로 드롭하면 저장 + 클립보드'],
  ['파일 관리자', 'TeamViewer, RustDesk, MeshCentral', '홈 폴더 탐색·전송'],
  ['다중 모니터', 'TeamViewer, AnyDesk, ToDesk (CRD는 제한적)', '화면 선택'],
  ['특수 키', 'CRD 툴바, TeamViewer', 'Ctrl+Alt+Del(막히면 안내), 작업관리자, Win, 잠금 등'],
  ['H.264 / P2P', 'CRD WebRTC, RustDesk', 'WebRTC 데이터채널 + ffmpeg H.264. 실패 시 JPEG'],
  ['ICE / TURN', 'CRD, TeamViewer', 'STUN + 허브 coturn(UDP/TCP 3478). LTE·엄한 NAT도 P2P'],
  ['소리', 'CRD, TeamViewer, AnyDesk', 'ffmpeg WASAPI 루프백. 묶음에 ffmpeg 포함'],
  ['세션 녹화', 'TeamViewer', '화면 20fps · 4Mbps WebM'],
  ['모바일 터치패드', 'ToDesk, AnyDesk', '상대 이동·탭 클릭·두 손가락 스크롤'],
  ['터미널 / SSH', 'MeshCentral, Guacamole, RustDesk 터널', '웹 터미널 + 로컬 SSH 2222'],
  ['채팅으로 PC 조작', 'Computer-use / Grok 스타일 (독자)', 'SpaceXAI(xAI) 도구 호출'],
  ['프라이버시 블랙 스크린', 'TeamViewer', '포함'],
  ['연결 해제 시 잠금', 'ToDesk, AnyDesk', '옵션'],
  ['WOL', 'TeamViewer', '이 PC 호스트가 먼저 매직패킷. 없으면 같은 계정의 다른 켜진 PC가 보냄'],
  ['호스트 설치 묶음', 'CRD 호스트, AnyDesk', 'Windows Setup.exe · Mac zip. 맥 로그인 화면은 없음'],
]

export default function Features() {
  return (
    <div className="page feat">
      <div className="top">
        <div className="brand">
          <img className="logo" src="/logo.svg" alt="" />
          <div>
            <h1>조사한 기능</h1>
            <p className="tag">Chrome Remote Desktop을 기준으로, TeamViewer · AnyDesk · RustDesk · MeshCentral · ToDesk · RemotePC · Guacamole에서 가져온 항목입니다.</p>
          </div>
        </div>
        <nav className="nav">
          <Link to="/">접속</Link>
        </nav>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>기능</th>
              <th>참고 제품</th>
              <th>RemoteAI</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[0]}>
                <td>{r[0]}</td>
                <td className="hint">{r[1]}</td>
                <td className="yes">{r[2]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
