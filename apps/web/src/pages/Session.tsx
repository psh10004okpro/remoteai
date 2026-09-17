import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import {
  BINARY,
  decodeFileChunk,
  decodeJpegFrame,
  decodePty,
  encodeFileChunk,
  FILE_CHUNK_SIZE,
  type DisplayInfo,
  type FileEntry,
  type Msg,
  type SpecialKey,
} from '@remoteai/protocol'
import { fetchLocalHost, localHostUrl, wsUrl } from '../lib/ws'
import { downloadBlob, zipStore } from '../lib/zip'
import { getToken } from '../lib/auth'

type ChatItem = { from: string; text: string }

export default function Session() {
  const [params] = useSearchParams()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sockRef = useRef<WebSocket | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const [status, setStatus] = useState('연결 중…')
  const [name, setName] = useState('')
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [displayId, setDisplayId] = useState(0)
  const [panel, setPanel] = useState<'none' | 'files' | 'ai' | 'term'>('none')
  const [chat, setChat] = useState<ChatItem[]>([])
  const [aiInput, setAiInput] = useState('')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [filePath, setFilePath] = useState('')
  const [touchpad, setTouchpad] = useState(matchMedia('(pointer: coarse)').matches)
  const [blank, setBlank] = useState(false)
  const incoming = useRef(
    new Map<number, { name: string; relativePath: string; chunks: Uint8Array[]; batchId?: string }>(),
  )
  const batches = useRef(new Map<string, number[]>())
  const transferId = useRef(1)
  const [quality, setQuality] = useState(55)
  const pad = useRef({ x: 0, y: 0, moved: false, pointers: new Map<number, { x: number; y: number }>() })
  const frameSize = useRef({ w: 16, h: 9 })

  const deviceId = params.get('id') || ''
  const password = params.get('pw') || ''
  const accountToken = params.get('token') || getToken()
  const code = params.get('code') || ''

  function send(msg: Msg) {
    const ws = sockRef.current
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg))
  }
  function sendBin(data: Uint8Array) {
    const ws = sockRef.current
    if (ws && ws.readyState === 1) ws.send(data)
  }

  useEffect(() => {
    const ws = new WebSocket(wsUrl())
    ws.binaryType = 'arraybuffer'
    sockRef.current = ws
    ws.onopen = () => {
      setStatus('인증 중…')
      if (code) send({ type: 'viewer.authCode', code })
      else send({ type: 'viewer.auth', deviceId, password: password || undefined, accountToken: accountToken || undefined })
    }
    ws.onclose = () => setStatus('연결 종료')
    ws.onerror = () => setStatus('연결 오류')
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') {
        const buf = new Uint8Array(ev.data as ArrayBuffer)
        if (buf[0] === BINARY.JPEG) {
          const frame = decodeJpegFrame(buf)
          if (frame) drawJpeg(frame.jpeg, frame.width, frame.height)
          return
        }
        if (buf[0] === BINARY.FILE) {
          const chunk = decodeFileChunk(buf)
          if (!chunk) return
          const rec = incoming.current.get(chunk.transferId)
          if (rec && chunk.chunk.length) rec.chunks.push(chunk.chunk)
          return
        }
        if (buf[0] === BINARY.PTY) {
          const d = decodePty(buf)
          if (d && term.current) term.current.write(new TextDecoder().decode(d))
        }
        return
      }
      const msg = JSON.parse(ev.data) as Msg
      switch (msg.type) {
        case 'viewer.welcome':
          setStatus(`${msg.name} 연결됨`)
          setName(msg.name)
          setDisplays(msg.displays)
          setDisplayId(msg.displays.find((d) => d.primary)?.id ?? 0)
          break
        case 'viewer.denied':
          setStatus(msg.message)
          break
        case 'session.end':
          setStatus(msg.reason)
          break
        case 'display.list':
          setDisplays(msg.displays)
          break
        case 'clipboard.text':
          if (msg.origin === 'host') {
            void navigator.clipboard.writeText(msg.text).catch(() => undefined)
            setChat((c) => [...c, { from: 'system', text: '원격 텍스트를 클립보드에 넣었습니다.' }])
          }
          break
        case 'file.listResult':
          setFiles(msg.entries)
          setFilePath(msg.path)
          break
        case 'file.start':
          if (msg.origin === 'host') {
            incoming.current.set(msg.transferId, {
              name: msg.name,
              relativePath: msg.relativePath || msg.name,
              chunks: [],
              batchId: msg.batchId,
            })
            if (msg.batchId) {
              const ids = batches.current.get(msg.batchId) || []
              ids.push(msg.transferId)
              batches.current.set(msg.batchId, ids)
            }
          }
          break
        case 'file.end':
          if (incoming.current.has(msg.transferId) && !incoming.current.get(msg.transferId)!.batchId) {
            const rec = incoming.current.get(msg.transferId)!
            incoming.current.delete(msg.transferId)
            finishReceive([{ name: rec.name, relativePath: rec.relativePath, data: concatChunks(rec.chunks) }])
          } else if (msg.savedPath && msg.origin !== 'host') {
            setChat((c) => [...c, { from: 'system', text: `원격 저장: ${msg.savedPath}` }])
          }
          break
        case 'clipboard.files.offer':
          setChat((c) => [
            ...c,
            { from: 'system', text: `원격에서 파일 ${msg.files.length}개 전송 중…` },
          ])
          break
        case 'clipboard.files.complete':
          if (msg.origin === 'host') {
            const ids = batches.current.get(msg.batchId) || []
            batches.current.delete(msg.batchId)
            const recs = ids
              .map((id) => incoming.current.get(id))
              .filter((x): x is NonNullable<typeof x> => !!x)
            for (const id of ids) incoming.current.delete(id)
            finishReceive(recs.map((r) => ({ name: r.name, relativePath: r.relativePath, data: concatChunks(r.chunks) })))
          }
          break
        case 'chat':
          setChat((c) => [...c, { from: msg.from, text: msg.text }])
          break
        case 'ai.assistant':
          setChat((c) => [...c, { from: 'ai', text: msg.text }])
          break
        case 'ai.status':
          setChat((c) => [...c, { from: 'system', text: msg.text }])
          break
        case 'ai.error':
          setChat((c) => [...c, { from: 'system', text: msg.message }])
          break
        default:
          break
      }
    }
    return () => ws.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, password, code, accountToken])

  function drawJpeg(jpeg: Uint8Array, w: number, h: number) {
    frameSize.current = { w, h }
    const blob = new Blob([jpeg], { type: 'image/jpeg' })
    createImageBitmap(blob).then((bmp) => {
      const c = canvasRef.current
      if (!c) return
      if (c.width !== bmp.width) c.width = bmp.width
      if (c.height !== bmp.height) c.height = bmp.height
      const ctx = c.getContext('2d')
      ctx?.drawImage(bmp, 0, 0)
      bmp.close()
    })
  }

  function pos(e: { clientX: number; clientY: number }) {
    const c = canvasRef.current
    if (!c) return null
    const r = c.getBoundingClientRect()
    return { nx: (e.clientX - r.left) / r.width, ny: (e.clientY - r.top) / r.height }
  }

  function onMouse(e: React.MouseEvent, action: 'move' | 'down' | 'up') {
    if (touchpad) return
    const p = pos(e)
    if (!p) return
    if (action !== 'move') e.preventDefault()
    send({ type: 'input.mouse', action, nx: p.nx, ny: p.ny, button: e.button, displayId })
  }

  useEffect(() => {
    function keys(e: KeyboardEvent, action: 'down' | 'up') {
      if (panel === 'ai' || panel === 'term') return
      if (!canvasRef.current) return
      e.preventDefault()
      send({
        type: 'input.key',
        action,
        code: e.code,
        key: e.key,
        ctrl: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey,
        meta: e.metaKey,
      })
    }
    const down = (e: KeyboardEvent) => keys(e, 'down')
    const up = (e: KeyboardEvent) => keys(e, 'up')
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    function onPaste(e: ClipboardEvent) {
      const dt = e.clipboardData
      if (!dt) return
      const items = dt.items
      const hasEntry = items && Array.from(items).some((it) => !!it.webkitGetAsEntry?.())
      if (hasEntry || (dt.files && dt.files.length)) {
        e.preventDefault()
        void collectAndSend(items, dt.files)
        return
      }
      const text = dt.getData('text')
      if (text) {
        e.preventDefault()
        send({ type: 'clipboard.text', text, origin: 'viewer' })
      }
    }
    window.addEventListener('paste', onPaste)
    function onCopy() {
      /* host clipboard comes via protocol */
    }
    window.addEventListener('copy', onCopy)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('copy', onCopy)
    }
  }, [panel, displayId])

  function concatChunks(chunks: Uint8Array[]) {
    const n = chunks.reduce((s, c) => s + c.length, 0)
    const out = new Uint8Array(n)
    let o = 0
    for (const c of chunks) {
      out.set(c, o)
      o += c.length
    }
    return out
  }

  async function pushToNativeClipboard(files: { name: string; relativePath: string; data: Uint8Array }[]) {
    const local = await fetchLocalHost()
    if (!local) return false
    const batch = `b${Date.now()}`
    for (const f of files) {
      const r = await fetch(
        `${localHostUrl()}/clip-file?batch=${encodeURIComponent(batch)}&path=${encodeURIComponent(f.relativePath || f.name)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f.data },
      )
      if (!r.ok) return false
    }
    const done = await fetch(`${localHostUrl()}/clip-commit?batch=${encodeURIComponent(batch)}`, { method: 'POST' })
    return done.ok
  }

  function finishReceive(files: { name: string; relativePath: string; data: Uint8Array }[]) {
    if (!files.length) return
    void (async () => {
      const native = await pushToNativeClipboard(files)
      if (native) {
        setChat((c) => [
          ...c,
          { from: 'system', text: `파일 ${files.length}개를 이 컴퓨터 클립보드에 넣었습니다. 탐색기에서 Ctrl+V 로 붙여넣으세요.` },
        ])
        return
      }
      const folder = files.some((f) => f.relativePath.includes('/')) || files.length > 1
      if (folder) {
        downloadBlob(
          'RemoteAI-files.zip',
          zipStore(files.map((f) => ({ name: f.relativePath || f.name, data: f.data }))),
        )
        setChat((c) => [...c, { from: 'system', text: `이 PC에 호스트가 없어 zip으로 받았습니다. 호스트를 켜면 바로 붙여넣기가 됩니다.` }])
        return
      }
      downloadBlob(files[0].name, new Blob([files[0].data]))
      setChat((c) => [...c, { from: 'system', text: `파일 수신: ${files[0].name}` }])
    })()
  }

  async function sendFiles(list: File[], relative: string[] = []) {
    if (!list.length) return
    const batchId = `${Date.now()}-${transferId.current}`
    send({
      type: 'clipboard.files.offer',
      origin: 'viewer',
      batchId,
      files: list.map((f, i) => ({ name: f.name, size: f.size, relativePath: relative[i] || f.name })),
    })
    for (let i = 0; i < list.length; i++) {
      const f = list[i]
      const id = transferId.current++
      const rel = relative[i] || f.name
      send({ type: 'file.start', transferId: id, name: f.name, size: f.size, relativePath: rel, origin: 'viewer', batchId })
      const buf = new Uint8Array(await f.arrayBuffer())
      let seq = 0
      for (let off = 0; off < buf.length; off += FILE_CHUNK_SIZE) {
        const slice = buf.subarray(off, off + FILE_CHUNK_SIZE)
        sendBin(encodeFileChunk(id, seq++, off + FILE_CHUNK_SIZE >= buf.length, slice))
      }
      if (buf.length === 0) sendBin(encodeFileChunk(id, 0, true, new Uint8Array()))
      send({ type: 'file.end', transferId: id, origin: 'viewer', batchId })
    }
    send({ type: 'clipboard.files.complete', origin: 'viewer', batchId })
  }

  async function collectAndSend(items: DataTransferItemList | null, fallback: FileList | null) {
    const files: File[] = []
    const rels: string[] = []
    const walk = async (entry: FileSystemEntry, prefix: string) => {
      if (entry.isFile) {
        await new Promise<void>((resolve) =>
          (entry as FileSystemFileEntry).file((f) => {
            files.push(f)
            rels.push(prefix + f.name)
            resolve()
          }),
        )
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader()
        const ents = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries((v) => resolve(v)))
        for (const child of ents) await walk(child, prefix + entry.name + '/')
      }
    }
    if (items && items.length) {
      for (const it of Array.from(items)) {
        const entry = it.webkitGetAsEntry?.()
        if (entry) await walk(entry, '')
        else if (it.kind === 'file') {
          const f = it.getAsFile()
          if (f) {
            files.push(f)
            rels.push(f.name)
          }
        }
      }
    } else if (fallback) {
      files.push(...Array.from(fallback))
    }
    await sendFiles(files, rels)
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault()
    await collectAndSend(e.dataTransfer.items, e.dataTransfer.files)
  }

  function special(key: SpecialKey) {
    send({ type: 'input.special', key })
  }

  useEffect(() => {
    if (panel === 'files') send({ type: 'file.list', path: filePath || '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel])

  useEffect(() => {
    if (panel !== 'term' || !termRef.current) return
    if (!term.current) {
      const t = new Terminal({ fontSize: 13, theme: { background: '#111' } })
      const fit = new FitAddon()
      t.loadAddon(fit)
      t.open(termRef.current)
      fit.fit()
      t.onData((d) => send({ type: 'term.data', data: d }))
      term.current = t
      send({ type: 'term.open' })
    }
  }, [panel])

  const specials: { k: SpecialKey; l: string }[] = useMemo(
    () => [
      { k: 'cad', l: 'Ctrl+Alt+Del' },
      { k: 'taskmgr', l: '작업관리자' },
      { k: 'lock', l: '잠금' },
      { k: 'win', l: 'Win' },
      { k: 'alttab', l: 'Alt+Tab' },
      { k: 'desktop', l: '바탕화면' },
      { k: 'explorer', l: '탐색기' },
    ],
    [],
  )

  return (
    <div className="session">
      <div className="toolbar">
        <Link to="/" style={{ color: '#ccc', fontSize: 13 }}>
          나가기
        </Link>
        <span style={{ fontSize: 13 }}>{status}{name ? ` · ${name}` : ''}</span>
        <select
          value={displayId}
          onChange={(e) => {
            const id = Number(e.target.value)
            setDisplayId(id)
            send({ type: 'display.select', displayId: id })
          }}
        >
          {displays.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} {d.primary ? '(주)' : ''} {d.width}x{d.height}
            </option>
          ))}
        </select>
        {specials.map((s) => (
          <button key={s.k} type="button" onClick={() => special(s.k)}>
            {s.l}
          </button>
        ))}
        <button type="button" onClick={() => setPanel(panel === 'files' ? 'none' : 'files')}>
          파일
        </button>
        <button
          type="button"
          onClick={() => {
            setPanel(panel === 'ai' ? 'none' : 'ai')
          }}
        >
          AI
        </button>
        <button type="button" onClick={() => setPanel(panel === 'term' ? 'none' : 'term')}>
          터미널
        </button>
        <button
          type="button"
          onClick={() => {
            setBlank((b) => {
              send({ type: 'privacy.blank', on: !b })
              return !b
            })
          }}
        >
          {blank ? '화면 표시' : '블랙스크린'}
        </button>
        <button type="button" onClick={() => setTouchpad((t) => !t)}>
          {touchpad ? '터치패드' : '절대좌표'}
        </button>
        <button
          type="button"
          onClick={() => {
            const el = document.documentElement
            if (!document.fullscreenElement) void el.requestFullscreen()
            else void document.exitFullscreen()
          }}
        >
          전체화면
        </button>
        <label style={{ fontSize: 12, color: '#bbb' }}>
          화질
          <input
            type="range"
            min={30}
            max={90}
            value={quality}
            onChange={(e) => {
              const jpegQuality = Number(e.target.value)
              setQuality(jpegQuality)
              send({ type: 'quality.set', quality: { jpegQuality } })
            }}
          />
        </label>
        <span className="spacer" />
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div
          className="stage"
          ref={stageRef}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <canvas
            ref={canvasRef}
            tabIndex={0}
            onMouseMove={(e) => onMouse(e, 'move')}
            onMouseDown={(e) => onMouse(e, 'down')}
            onMouseUp={(e) => onMouse(e, 'up')}
            onContextMenu={(e) => e.preventDefault()}
            onWheel={(e) => {
              e.preventDefault()
              const p = pos(e)
              send({ type: 'input.mouse', action: 'wheel', dy: e.deltaY, nx: p?.nx, ny: p?.ny, displayId })
            }}
            onPointerDown={(e) => {
              if (!touchpad) return
              pad.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
              pad.current.moved = false
              ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              if (!touchpad) return
              const prev = pad.current.pointers.get(e.pointerId)
              if (!prev) return
              const dx = e.clientX - prev.x
              const dy = e.clientY - prev.y
              pad.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
              if (Math.abs(dx) + Math.abs(dy) > 2) pad.current.moved = true
              if (pad.current.pointers.size >= 2) {
                send({ type: 'input.mouse', action: 'wheel', dy: dy * 4, displayId })
                return
              }
              pad.current.x = Math.min(0.999, Math.max(0, (pad.current.x || 0.5) + dx / 900))
              pad.current.y = Math.min(0.999, Math.max(0, (pad.current.y || 0.5) + dy / 900))
              send({ type: 'input.mouse', action: 'move', nx: pad.current.x, ny: pad.current.y, displayId })
            }}
            onPointerUp={(e) => {
              if (!touchpad) return
              pad.current.pointers.delete(e.pointerId)
              if (!pad.current.moved) {
                send({ type: 'input.mouse', action: 'down', nx: pad.current.x || 0.5, ny: pad.current.y || 0.5, button: 0, displayId })
                send({ type: 'input.mouse', action: 'up', nx: pad.current.x || 0.5, ny: pad.current.y || 0.5, button: 0, displayId })
              }
            }}
          />
        </div>
        {panel !== 'none' && (
          <aside className="drawer">
            {panel === 'files' && (
              <>
                <header>
                  파일 · {filePath || '홈'}
                  <button
                    style={{ marginLeft: 8 }}
                    type="button"
                    onClick={() => send({ type: 'file.list', path: filePath || '' })}
                  >
                    새로고침
                  </button>
                </header>
                <div className="files">
                  <button
                    className="link"
                    type="button"
                    onClick={() => {
                      const parent = filePath.replace(/[\\/][^\\/]+$/, '')
                      send({ type: 'file.list', path: parent })
                    }}
                  >
                    ..
                  </button>
                  {files.map((f) => (
                    <button
                      key={f.path}
                      className="link"
                      type="button"
                      onClick={() => {
                        if (f.dir) send({ type: 'file.list', path: f.path })
                        else send({ type: 'file.get', path: f.path })
                      }}
                    >
                      {f.dir ? '📁' : '📄'} {f.name}
                    </button>
                  ))}
                  <p className="hint" style={{ color: '#888' }}>
                    파일을 화면으로 끌어다 놓거나 Ctrl+V 로 붙여넣으면 원격 Downloads/RemoteAI 에 저장되고 클립보드에도 올라갑니다.
                  </p>
                </div>
              </>
            )}
            {panel === 'ai' && (
              <>
                <header>AI로 이 컴퓨터 조작 · 채팅</header>
                <div className="chat">
                  {chat.map((m, i) => (
                    <div key={i} className={`bubble ${m.from === 'ai' ? 'ai' : m.from === 'system' ? 'sys' : 'me'}`}>
                      {m.text}
                    </div>
                  ))}
                </div>
                <form
                  style={{ display: 'flex', gap: 6, padding: 8 }}
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!aiInput.trim()) return
                    setChat((c) => [...c, { from: 'me', text: aiInput }])
                    send({ type: 'ai.user', text: aiInput })
                    setAiInput('')
                  }}
                >
                  <input
                    style={{ flex: 1 }}
                    value={aiInput}
                    onChange={(e) => setAiInput(e.target.value)}
                    placeholder="예: 메모장 열고 오늘 일정 적어줘"
                  />
                  <button className="btn" type="submit">
                    보내기
                  </button>
                </form>
              </>
            )}
            {panel === 'term' && (
              <>
                <header>PowerShell / SSH 스타일 터미널</header>
                <div ref={termRef} style={{ flex: 1, minHeight: 0 }} />
              </>
            )}
          </aside>
        )}
      </div>
      <div className="mobile-bar">
        <button type="button" onClick={() => setTouchpad(true)}>
          패드
        </button>
        <input
          placeholder="텍스트 전송"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              send({ type: 'input.text', text: (e.target as HTMLInputElement).value })
              ;(e.target as HTMLInputElement).value = ''
            }
          }}
        />
        <button type="button" onClick={() => special('win')}>
          Win
        </button>
      </div>
    </div>
  )
}
