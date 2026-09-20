import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import {
  BINARY,
  decodeFileChunk,
  decodeJpegFrame,
  decodeAudio,
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
import { clearPendingSession, getToken, reportClientError, takePendingSession } from '../lib/auth'

type ChatItem = { from: string; text: string }

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

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
  const recvXfer = useRef({ sizes: new Map<number, number>(), sent: new Map<number, number>() })
  const transferId = useRef(1)
  const [quality, setQuality] = useState(55)
  const [autoQ, setAutoQ] = useState(true)
  const [viewOnly, setViewOnly] = useState(false)
  const [more, setMore] = useState(false)
  const [keysOn, setKeysOn] = useState(false)
  const [reconnect, setReconnect] = useState(false)
  const [toast, setToast] = useState('')
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  const [recording, setRecording] = useState(false)
  const [soundOn, setSoundOn] = useState(false)
  const [rtcOn, setRtcOn] = useState(false)
  const [cursor, setCursor] = useState({ x: 0.5, y: 0.5 })
  const pad = useRef({
    x: 0.5,
    y: 0.5,
    moved: false,
    pointers: new Map<number, { x: number; y: number }>(),
    pinchDist: 0,
    pinchZoom: 1,
  })
  const frameSize = useRef({ w: 16, h: 9 })
  const recRef = useRef<MediaRecorder | null>(null)
  const rtcRef = useRef<RTCPeerConnection | null>(null)
  const vdec = useRef<VideoDecoder | null>(null)
  const audioCtx = useRef<AudioContext | null>(null)
  const recChunks = useRef<Blob[]>([])
  const retryRef = useRef(0)
  const alive = useRef(true)
  const reconnecting = useRef(false)
  const jpegBusy = useRef(false)
  const jpegLatest = useRef<{ u8: Uint8Array; w: number; h: number } | null>(null)
  const lastMove = useRef(0)
  const msgHandler = useRef<(ev: MessageEvent) => void>(() => undefined)

  const [deviceId] = useState(() => params.get('id') || takePendingSession())
  const password = params.get('pw') || ''
  const accountToken = getToken()
  const code = params.get('code') || ''

  function send(msg: Msg) {
    const ws = sockRef.current
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg))
  }
  function sendBin(data: Uint8Array) {
    const ws = sockRef.current
    if (ws && ws.readyState === 1) ws.send(data)
  }

  function sendAuth(ws?: WebSocket) {
    const s = ws || sockRef.current
    if (!s || s.readyState !== 1) return
    if (code) s.send(JSON.stringify({ type: 'viewer.authCode', code }))
    else
      s.send(
        JSON.stringify({
          type: 'viewer.auth',
          deviceId,
          password: password || undefined,
          accountToken: accountToken || undefined,
        }),
      )
    s.send(JSON.stringify({ type: 'session.fit', width: window.innerWidth, height: window.innerHeight }))
  }

  function connectWs() {
    const prev = sockRef.current
    sockRef.current = null
    try {
      prev?.close()
    } catch {
      /* ignore */
    }
    const ws = new WebSocket(wsUrl())
    ws.binaryType = 'arraybuffer'
    sockRef.current = ws
    ws.onopen = () => {
      retryRef.current = 0
      reconnecting.current = false
      setReconnect(false)
      setStatus('인증 중…')
      sendAuth(ws)
    }
    ws.onclose = () => {
      if (sockRef.current !== ws) return
      setStatus('연결 종료')
      if (!alive.current) return
      reconnecting.current = true
      setReconnect(true)
      const wait = Math.min(8000, 800 * 2 ** retryRef.current++)
      setTimeout(() => {
        if (alive.current) connectWs()
      }, wait)
    }
    ws.onerror = () => setStatus('연결 오류')
    ws.onmessage = (ev) => msgHandler.current(ev)
    return ws
  }

  useEffect(() => {
    alive.current = true
    const ws = connectWs()
    msgHandler.current = (ev) => {
      if (typeof ev.data !== 'string') {
        handleBin(new Uint8Array(ev.data as ArrayBuffer))
        return
      }
      const msg = JSON.parse(ev.data) as Msg
      switch (msg.type) {
        case 'webrtc.offer':
          void applyOffer(msg.sdp)
          break
        case 'webrtc.ice':
          void rtcRef.current?.addIceCandidate({
            candidate: msg.candidate,
            sdpMid: msg.sdpMid ?? undefined,
            sdpMLineIndex: msg.sdpMLineIndex ?? undefined,
          }).catch(() => undefined)
          break
        case 'viewer.welcome':
          reconnecting.current = false
          setReconnect(false)
          setStatus(`${msg.name} 연결됨`)
          setName(msg.name)
          setDisplays(msg.displays)
          setDisplayId(msg.displays.find((d) => d.primary)?.id ?? 0)
          clearPendingSession()
          break
        case 'viewer.denied':
          if (msg.message.includes('온라인이 아닙니다')) {
            reconnecting.current = true
            setReconnect(true)
            setStatus('컴퓨터가 아직 꺼져 있습니다. 다시 연결 중…')
            window.setTimeout(() => {
              if (alive.current) sendAuth()
            }, 2500)
          } else {
            setStatus(msg.message)
            void reportClientError('session', 'viewer.denied: ' + msg.message)
          }
          break
        case 'session.end':
          reconnecting.current = true
          setReconnect(true)
          setStatus(msg.reason + ' · 다시 연결 중…')
          window.setTimeout(() => {
            if (alive.current) sendAuth()
          }, 1500)
          break
        case 'display.list':
          setDisplays(msg.displays)
          if (reconnecting.current) {
            reconnecting.current = false
            setReconnect(false)
            setStatus('다시 연결됨')
          }
          break
        case 'clipboard.text':
          if (msg.origin === 'host') {
            void navigator.clipboard.writeText(msg.text).catch(() => undefined)
            setChat((c) => [...c, { from: 'system', text: '원격 텍스트를 클립보드에 넣었습니다.' }])
          }
          break
        case 'file.progress': {
          recvXfer.current.sent.set(msg.transferId, msg.sent)
          if (msg.total && !recvXfer.current.sizes.has(msg.transferId)) {
            recvXfer.current.sizes.set(msg.transferId, msg.total)
          }
          let sent = 0
          let total = 0
          for (const [id, t] of recvXfer.current.sizes) {
            total += t
            sent += recvXfer.current.sent.get(id) || 0
          }
          if (total) setProgress({ sent, total })
          else setProgress({ sent: msg.sent, total: msg.total })
          break
        }
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
            if (msg.size) recvXfer.current.sizes.set(msg.transferId, msg.size)
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
            recvXfer.current.sizes.delete(msg.transferId)
            recvXfer.current.sent.delete(msg.transferId)
            setTimeout(() => setProgress(null), 800)
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
            recvXfer.current.sizes.clear()
            recvXfer.current.sent.clear()
            setTimeout(() => setProgress(null), 800)
            finishReceive(recs.map((r) => ({ name: r.name, relativePath: r.relativePath, data: concatChunks(r.chunks) })))
          }
          break
        case 'chat':
          setChat((c) => [...c, { from: msg.from, text: msg.text }])
          if (msg.from === 'system') {
            setToast(msg.text)
            window.setTimeout(() => setToast(''), 4500)
          }
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
    const ping = setInterval(() => send({ type: 'ping', t: Date.now() }), 2000)
    const onResize = () => send({ type: 'session.fit', width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    const closeMore = () => setMore(false)
    window.addEventListener('click', closeMore)
    return () => {
      alive.current = false
      clearInterval(ping)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('click', closeMore)
      ws.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, password, code, accountToken])

  function handleBin(buf: Uint8Array) {
    if (reconnecting.current) {
      reconnecting.current = false
      setReconnect(false)
      setStatus('다시 연결됨')
    }
    if (buf[0] === BINARY.JPEG) {
      const frame = decodeJpegFrame(buf)
      if (frame) drawJpeg(frame.jpeg, frame.width, frame.height)
      return
    }
    if (buf[0] === BINARY.H264) {
      decodeH264(buf)
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
      return
    }
    if (buf[0] === BINARY.AUDIO) {
      const pcm = decodeAudio(buf)
      if (pcm) playPcm(pcm)
    }
  }

  async function applyOffer(sdp: string) {
    try {
      rtcRef.current?.close()
      let iceServers: RTCIceServer[] = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
      ]
      try {
        const ice = await fetch('/api/ice').then((r) => r.json())
        if (ice.iceServers?.length) iceServers = ice.iceServers
      } catch {
        /* keep stun */
      }
      const pc = new RTCPeerConnection({ iceServers })
      rtcRef.current = pc
      pc.ondatachannel = (ev) => {
        ev.channel.binaryType = 'arraybuffer'
        ev.channel.onmessage = (e) => handleBin(new Uint8Array(e.data as ArrayBuffer))
        setRtcOn(true)
      }
      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          send({
            type: 'webrtc.ice',
            candidate: ev.candidate.candidate,
            sdpMid: ev.candidate.sdpMid,
            sdpMLineIndex: ev.candidate.sdpMLineIndex,
          })
        }
      }
      await pc.setRemoteDescription({ type: 'offer', sdp })
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      send({ type: 'webrtc.answer', sdp: answer.sdp || '' })
    } catch {
      send({ type: 'webrtc.failed' })
    }
  }

  function decodeH264(buf: Uint8Array) {
    if (typeof VideoDecoder === 'undefined') return
    const key = buf[1] === 1
    const nal = buf.subarray(2)
    const framed = new Uint8Array(4 + nal.length)
    framed[0] = 0
    framed[1] = 0
    framed[2] = 0
    framed[3] = 1
    framed.set(nal, 4)
    try {
      if (!vdec.current || vdec.current.state === 'closed') {
        const dec = new VideoDecoder({
          output: (frame) => {
            const c = canvasRef.current
            if (c) {
              if (c.width !== frame.displayWidth) c.width = frame.displayWidth
              if (c.height !== frame.displayHeight) c.height = frame.displayHeight
              c.getContext('2d')?.drawImage(frame, 0, 0)
            }
            frame.close()
          },
          error: () => {
            vdec.current = null
          },
        })
        dec.configure({ codec: 'avc1.42E01E', optimizeForLatency: true })
        vdec.current = dec
      }
      if (vdec.current.state !== 'configured') return
      vdec.current.decode(
        new EncodedVideoChunk({
          type: key ? 'key' : 'delta',
          timestamp: Math.round(performance.now() * 1000),
          data: framed,
        }),
      )
    } catch {
      vdec.current = null
    }
  }

  function drawJpeg(jpeg: Uint8Array, w: number, h: number) {
    frameSize.current = { w, h }
    jpegLatest.current = { u8: jpeg.slice(), w, h }
    if (jpegBusy.current) return
    jpegBusy.current = true
    const pump = () => {
      const job = jpegLatest.current
      if (!job) {
        jpegBusy.current = false
        return
      }
      jpegLatest.current = null
      createImageBitmap(new Blob([job.u8], { type: 'image/jpeg' }))
        .then((bmp) => {
          const c = canvasRef.current
          if (c) {
            if (c.width !== bmp.width) c.width = bmp.width
            if (c.height !== bmp.height) c.height = bmp.height
            const ctx = c.getContext('2d', { alpha: false })
            ctx?.drawImage(bmp, 0, 0)
          }
          bmp.close()
          if (jpegLatest.current) pump()
          else jpegBusy.current = false
        })
        .catch(() => {
          jpegBusy.current = false
        })
    }
    pump()
  }

  function pos(e: { clientX: number; clientY: number }) {
    const c = canvasRef.current
    if (!c) return null
    const r = c.getBoundingClientRect()
    return { nx: (e.clientX - r.left) / r.width, ny: (e.clientY - r.top) / r.height }
  }

  function onMouse(e: React.MouseEvent, action: 'move' | 'down' | 'up') {
    if (viewOnly || touchpad) return
    const p = pos(e)
    if (!p) return
    if (action === 'move') {
      const n = Date.now()
      if (n - lastMove.current < 24) return
      lastMove.current = n
    } else e.preventDefault()
    send({ type: 'input.mouse', action, nx: p.nx, ny: p.ny, button: e.button, displayId })
  }

  useEffect(() => {
    function keys(e: KeyboardEvent, action: 'down' | 'up') {
      if (viewOnly || panel === 'ai' || panel === 'term') return
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
  }, [panel, displayId, viewOnly])

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
        setToast('파일이 클립보드에 있습니다. 탐색기에서 Ctrl+V')
        setTimeout(() => setToast(''), 3500)
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
    if (viewOnly) return
    if (!list.length) return
    const batchId = `${Date.now()}-${transferId.current}`
    const grand = list.reduce((n, f) => n + f.size, 0) || 1
    let done = 0
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
        done += slice.length
        if (seq % 4 === 0 || off + FILE_CHUNK_SIZE >= buf.length) {
          send({ type: 'file.progress', transferId: id, sent: off + slice.length, total: buf.length || 1 })
          setProgress({ sent: done, total: grand })
        }
      }
      if (buf.length === 0) sendBin(encodeFileChunk(id, 0, true, new Uint8Array()))
      send({ type: 'file.end', transferId: id, origin: 'viewer', batchId })
    }
    send({ type: 'clipboard.files.complete', origin: 'viewer', batchId })
    setProgress({ sent: grand, total: grand })
    setTimeout(() => setProgress(null), 800)
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

  function playPcm(pcm: Uint8Array) {
    try {
      const ctx = audioCtx.current || new AudioContext({ sampleRate: 16000 })
      audioCtx.current = ctx
      const n = Math.floor(pcm.length / 2)
      const f32 = new Float32Array(n)
      const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
      for (let i = 0; i < n; i++) f32[i] = view.getInt16(i * 2, true) / 32768
      const buf = ctx.createBuffer(1, n, 16000)
      buf.getChannelData(0).set(f32)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      src.start()
    } catch {
      /* ignore */
    }
  }

  function startRec() {
    const c = canvasRef.current
    if (!c) return
    const stream = c.captureStream(20)
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 4_000_000 })
    recChunks.current = []
    rec.ondataavailable = (e) => {
      if (e.data.size) recChunks.current.push(e.data)
    }
    rec.onstop = () => {
      downloadBlob('remoteai-session.webm', new Blob(recChunks.current, { type: 'video/webm' }))
    }
    rec.start(1000)
    recRef.current = rec
    setRecording(true)
  }

  return (
    <div className="session">
      <div className="toolbar">
        <Link to="/" style={{ color: '#ccc', fontSize: 13 }}>
          나가기
        </Link>
        <span style={{ fontSize: 13 }}>{status}{name ? ` · ${name}` : ''}{rtcOn ? ' · P2P' : ''}{recording ? ' · 녹화' : ''}</span>
        {displays.length > 1 && (
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
                {d.name} {d.primary ? '(주)' : ''}
              </option>
            ))}
          </select>
        )}
        <button type="button" onClick={() => setPanel(panel === 'files' ? 'none' : 'files')}>파일</button>
        <button type="button" onClick={() => setPanel(panel === 'ai' ? 'none' : 'ai')}>AI</button>
        <button type="button" onClick={() => setPanel(panel === 'term' ? 'none' : 'term')}>터미널</button>
        <span className="spacer" />
        <div className="more">
          <button type="button" onClick={(e) => { e.stopPropagation(); setMore((m) => !m) }}>더보기</button>
          {more && (
            <div className="more-menu" onClick={(e) => e.stopPropagation()}>
              {specials.map((s) => (
                <button key={s.k} type="button" onClick={() => special(s.k)}>{s.l}</button>
              ))}
              <button type="button" onClick={() => { setViewOnly((v) => { send({ type: 'session.viewOnly', on: !v }); return !v }) }}>
                {viewOnly ? '조작 켜기' : '보기만'}
              </button>
              <button type="button" onClick={() => { setBlank((b) => { send({ type: 'privacy.blank', on: !b }); return !b }) }}>
                {blank ? '화면 표시' : '블랙스크린'}
              </button>
              <button type="button" onClick={() => setTouchpad((t) => !t)}>
                {touchpad ? '터치패드' : '직접 터치'}
              </button>
              <button type="button" onClick={() => { const el = document.documentElement; if (!document.fullscreenElement) void el.requestFullscreen(); else void document.exitFullscreen() }}>
                전체화면
              </button>
              <button type="button" onClick={() => setAutoQ((a) => {
                const next = !a
                send({ type: 'quality.auto', on: next })
                return next
              })}>
                {autoQ ? '화질 자동' : '화질 수동'}
              </button>
              {!autoQ && (
                <label style={{ fontSize: 12, color: '#bbb' }}>
                  화질
                  <input type="range" min={30} max={90} value={quality} onChange={(e) => {
                    const jpegQuality = Number(e.target.value)
                    setQuality(jpegQuality)
                    send({ type: 'quality.set', quality: { jpegQuality } })
                  }} />
                </label>
              )}
              <button type="button" onClick={() => {
                if (recording) { recRef.current?.stop(); setRecording(false) }
                else startRec()
              }}>{recording ? '녹화 중지' : '세션 녹화'}</button>
              <button type="button" onClick={() => {
                setSoundOn((s) => {
                  send({ type: 'audio.toggle', on: !s })
                  return !s
                })
              }}>{soundOn ? '소리 끄기' : '소리 켜기'}</button>
            </div>
          )}
        </div>
      </div>
      {progress && progress.total > 0 && (
        <div className="xfer">
          <div className="progress"><span style={{ width: `${Math.min(100, Math.round((progress.sent / progress.total) * 100))}%` }} /></div>
          <span>{fmtBytes(progress.sent)} / {fmtBytes(progress.total)}</span>
        </div>
      )}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div
          className="stage"
          ref={stageRef}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
        >
          {reconnect && (
            <div className="overlay">
              <div>다시 연결하는 중…</div>
              <button className="btn" type="button" onClick={() => { retryRef.current = 0; connectWs() }}>지금 재시도</button>
            </div>
          )}
          {touchpad && (
            <div
              className="vcursor"
              style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}
            />
          )}
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
              if (pad.current.pointers.size === 2) {
                const pts = [...pad.current.pointers.values()]
                pad.current.pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
                pad.current.pinchZoom = zoomRef.current
              }
              ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              if (viewOnly) return
              if (!touchpad) return
              const prev = pad.current.pointers.get(e.pointerId)
              if (!prev) return
              const dx = e.clientX - prev.x
              const dy = e.clientY - prev.y
              pad.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
              if (Math.abs(dx) + Math.abs(dy) > 2) pad.current.moved = true
              if (pad.current.pointers.size >= 2) {
                const pts = [...pad.current.pointers.values()]
                const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
                if (pad.current.pinchDist > 8) {
                  const z = Math.min(2.5, Math.max(0.6, pad.current.pinchZoom * (d / pad.current.pinchDist)))
                  zoomRef.current = z
                  setZoom(z)
                }
                return
              }
              pad.current.x = Math.min(0.999, Math.max(0, (pad.current.x || 0.5) + dx / 900))
              pad.current.y = Math.min(0.999, Math.max(0, (pad.current.y || 0.5) + dy / 900))
              setCursor({ x: pad.current.x, y: pad.current.y })
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
                  {progress && (
                    <>
                      <div className="progress"><span style={{ width: `${Math.min(100, Math.round((progress.sent / progress.total) * 100))}%` }} /></div>
                      <p className="hint">{fmtBytes(progress.sent)} / {fmtBytes(progress.total)}</p>
                    </>
                  )}
                  <label className="btn ghost" style={{ display: 'inline-block', marginTop: 8 }}>
                    업로드
                    <input
                      type="file"
                      multiple
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const list = e.target.files
                        if (list?.length) void sendFiles(Array.from(list))
                        e.target.value = ''
                      }}
                    />
                  </label>
                  <p className="hint" style={{ color: '#888' }}>
                    끌어다 놓거나 붙여넣기, 업로드로 보냅니다.
                  </p>
                </div>
              </>
            )}
            {panel === 'ai' && (
              <>
                <header>AI로 이 컴퓨터 조작 · 채팅{viewOnly ? ' (보기 전용)' : ''}</header>
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
                    if (viewOnly) {
                      setChat((c) => [...c, { from: 'system', text: '보기 전용이라 AI로 조작할 수 없습니다.' }])
                      return
                    }
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
      {keysOn && (
        <div className="keys">
          {['Escape', 'Tab', 'ControlLeft', 'AltLeft', 'MetaLeft', 'Enter', 'Backspace'].map((code) => (
            <button
              key={code}
              type="button"
              onPointerDown={() => send({ type: 'input.key', action: 'down', code, key: code })}
              onPointerUp={() => send({ type: 'input.key', action: 'up', code, key: code })}
            >
              {code.replace('Left', '').replace('Meta', 'Win')}
            </button>
          ))}
          <input
            placeholder="한글 입력 후 Enter"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                send({ type: 'input.text', text: (e.target as HTMLInputElement).value })
                ;(e.target as HTMLInputElement).value = ''
              }
            }}
          />
        </div>
      )}
      <div className="mobile-bar">
        <button type="button" onClick={() => setTouchpad(true)}>커서</button>
        <button type="button" onClick={() => setKeysOn((k) => !k)}>키보드</button>
        <button type="button" onClick={() => { const z = Math.min(2.5, zoomRef.current + 0.2); zoomRef.current = z; setZoom(z) }}>+</button>
        <button type="button" onClick={() => { const z = Math.max(0.6, zoomRef.current - 0.2); zoomRef.current = z; setZoom(z) }}>−</button>
        <button type="button" onClick={() => special('win')}>Win</button>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
