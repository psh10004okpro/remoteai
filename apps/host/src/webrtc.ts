import { log } from './log.js'

type Ice = { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null }

let pc: {
  close(): void
  setRemoteDescription(d: { type: string; sdp: string }): Promise<void>
  addIceCandidate(c: Ice): Promise<void>
} | null = null
let channel: { readyState: string; send(data: Buffer | Uint8Array): void } | null = null

export async function fetchIce(serverUrl: string) {
  try {
    const r = await fetch(serverUrl.replace(/\/$/, '') + '/api/ice')
    const j = (await r.json()) as { iceServers?: { urls: string; username?: string; credential?: string }[] }
    if (j.iceServers?.length) return j.iceServers
  } catch {
    /* ignore */
  }
  return [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ]
}

export async function createOffer(opts: {
  onIce: (ice: Ice) => void
  onOpen: () => void
  iceServers?: { urls: string; username?: string; credential?: string }[]
}): Promise<string | null> {
  await closeRtc()
  try {
    const { RTCPeerConnection } = await import('werift')
    const peer = new RTCPeerConnection({
      iceServers: opts.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    const dc = peer.createDataChannel('media', { ordered: false, maxRetransmits: 0 })
    pc = peer
    channel = dc
    peer.onIceCandidate.subscribe((c) => {
      if (!c?.candidate) return
      opts.onIce({ candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex })
    })
    dc.stateChanged.subscribe((s) => {
      log('rtc channel', s)
      if (s === 'open') opts.onOpen()
    })
    dc.onopen = () => opts.onOpen()
    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    return peer.localDescription?.sdp || offer.sdp || null
  } catch (e) {
    log('webrtc offer failed', e)
    return null
  }
}

export async function setAnswer(sdp: string) {
  if (!pc) return
  await pc.setRemoteDescription({ type: 'answer', sdp })
}

export async function addIce(ice: Ice) {
  if (!pc || !ice.candidate) return
  try {
    await pc.addIceCandidate(ice)
  } catch (e) {
    log('ice', e)
  }
}

export function sendRtc(data: Uint8Array | Buffer) {
  if (!channel || channel.readyState !== 'open') return false
  try {
    channel.send(Buffer.isBuffer(data) ? data : Buffer.from(data))
    return true
  } catch {
    return false
  }
}

export async function closeRtc() {
  try {
    pc?.close()
  } catch {
    /* ignore */
  }
  pc = null
  channel = null
}
