# RemoteAI

Chrome 원격 데스크톱처럼 **브라우저만으로** Windows PC에 접속하는 프로그램입니다. 파일/폴더 클립보드, 드래그 앤 드롭, 다중 모니터, 특수 키, 웹 터미널·SSH, Grok 채팅으로 PC 조작을 포함합니다.

## 다른 컴퓨터에 설치 (호스트)

접속만 하면 되면 **설치하지 않습니다.** 브라우저에서 허브 주소로 로그인합니다.

원격으로 **열릴** Windows에는 호스트를 설치합니다.

```bat
npm run pack:host
```

`dist/RemoteAI-Host/설치.cmd` 를 그 PC에서 실행합니다. 바탕화면 바로가기가 생기고, 브라우저에서 같은 아이디로 로그인하면 목록에 올라갑니다.

접속하는 Windows에도 같은 설치를 하면 그 PC도 호스트가 되고, 파일 Ctrl+V 가 됩니다.

## 실행

Node 20+ 가 필요합니다.

```bat
cd C:\RemoteAI
npm install
npm run dev
```

브라우저가 `http://127.0.0.1:5173/#/host` 로 열립니다.

- 홈에서 **회원가입/로그인** 합니다. 같은 계정으로 로그인한 컴퓨터가 「내 컴퓨터」 목록에 나타납니다.
- A에서 B로, B에서 A로 서로 접속할 수 있습니다 (Chrome 원격 데스크톱과 같은 모델).
- 접속하는 PC에도 호스트가 켜져 있으면, 원격에서 복사한 파일을 이 PC 탐색기에 그대로 Ctrl+V 할 수 있습니다.
- 핸드폰은 같은 Wi-Fi에서 `http://192.168.x.x:5173` 입니다.

호스트 설정의 **부팅·로그온 시 자동 시작**을 켜면 Windows 로그온(그리고 권한이 되면 부팅) 때 중계 서버와 호스트가 같이 올라갑니다. 브라우저 창은 띄우지 않고 트레이만 뜹니다.

## AI 채팅

서버 폴더에 `.env` 를 만들고 xAI 키를 넣습니다.

```
XAI_API_KEY=...
XAI_MODEL=grok-4.6
```

세션 툴바의 **AI** 에서 채팅하면 화면 캡처·클릭·입력·PowerShell을 통해 원격 PC를 조작합니다.

## SSH

호스트가 로컬 `2222` 포트에 SSH 서버를 띄웁니다. 비밀번호는 원격 접속 PIN과 같습니다.

```
ssh -p 2222 %USERNAME%@127.0.0.1
```

LAN에서 열려면 호스트 설정의 “LAN SSH 허용”을 켭니다. 인터넷 경로는 세션 안 **터미널** 탭을 쓰면 됩니다.

## 계정 서버

같은 계정으로 여러 컴퓨터가 서로를 보려면 **계정 서버가 하나**여야 합니다. Chrome 원격 데스크톱이 Google 서버를 쓰는 것과 같습니다.

이미 `apps/server` 가 그 역할입니다(회원가입, 로그인, 내 컴퓨터 목록, 화면 중계). 다만 각 PC가 자기 `localhost` 서버를 따로 띄우면 계정이 갈라집니다.

1. **허브 PC**(항상 켜 둘 컴퓨터)에서 서버를 실행하고, 호스트 설정에서 「이 컴퓨터가 계정 서버입니다」를 켭니다.
2. **다른 PC**는 호스트만 켜고, 계정 서버 주소에 허브의 `http://허브-IP:18790` 를 넣습니다.
3. 회원가입·로그인·원격 화면은 모두 그 주소로 합니다. 핸드폰도 그 주소를 엽니다.
4. 집 밖에서 쓰려면 허브의 18790 포트를 공유기에서 열거나 `cloudflared tunnel --url http://127.0.0.1:18790` 같은 터널을 씁니다.

허브만 따로 띄우기:

```bat
npm run start -w @remoteai/server
```

## Vultr + Coolify 배포

계정 서버(`apps/server` + 웹)를 Docker로 묶어 두었습니다. Windows 호스트 에이전트는 각 PC에 그대로 두고, **허브만** Coolify에 올립니다.

1. Vultr VPS에 Coolify를 설치한 뒤, 이 저장소를 Git으로 연결합니다.
2. 새 리소스 → **Dockerfile** (또는 Docker Compose, 파일은 저장소 루트 `Dockerfile` / `docker-compose.yml`).
3. **Ports Exposes** 를 `18790` 으로 둡니다. 프로세스는 `0.0.0.0` 에 붙습니다.
4. 도메인을 붙입니다 (예: `https://remote.example.com`). HTTPS는 Coolify 프록시가 처리하고, 브라우저는 같은 주소로 `wss://.../ws` 에 연결합니다.
5. 환경 변수:
   - `PORT=18790`
   - `DATA_DIR=/data`
   - `PUBLIC_URL=https://remote.example.com` (붙인 도메인)
   - `XAI_API_KEY` (AI 채팅을 쓸 때만)
6. **Persistent Storage**: Volume → Destination `/data` (회원가입·기기 목록이 재배포 후에도 남습니다).
7. 배포 후 `https://도메인/api/health` 가 `{ "ok": true, "role": "account-hub" }` 인지 확인합니다.
8. 각 Windows PC 호스트 설정에서 「이 컴퓨터가 계정 서버입니다」를 끄고, 계정 서버 주소에 `https://도메인` 을 저장한 다음 같은 아이디로 로그인합니다.

로컬에서 이미지 확인:

```bat
docker compose up --build
```

## 구성

- `apps/host` — 화면 캡처, 마우스/키보드, 클립보드, 파일, SSH
- `apps/server` — 계정·기기 목록·중계 (허브)
- `apps/web` — 뷰어 (PC/폰)
- `packages/protocol` — 메시지 형식
