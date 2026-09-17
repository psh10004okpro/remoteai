import { createWriteStream, mkdirSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { FileEntry } from '@remoteai/protocol'
import { dropDir } from './config.js'
import { setClipboardFiles } from './clipboard.js'
import { log } from './log.js'

export async function listPath(target: string): Promise<{ path: string; entries: FileEntry[] }> {
  const dir = target || os.homedir()
  const names = await readdir(dir)
  const entries: FileEntry[] = []
  for (const name of names.slice(0, 400)) {
    const p = path.join(dir, name)
    try {
      const s = await stat(p)
      entries.push({ name, path: p, dir: s.isDirectory(), size: s.size, mtime: s.mtimeMs })
    } catch {
      /* skip */
    }
  }
  entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
  return { path: dir, entries }
}

export type FlatFile = { full: string; relativePath: string; name: string; size: number }

export async function flattenPaths(paths: string[]): Promise<FlatFile[]> {
  const out: FlatFile[] = []
  for (const p of paths) {
    await walk(p, path.basename(p), out)
  }
  return out
}

async function walk(full: string, rel: string, out: FlatFile[]) {
  const s = await stat(full)
  if (s.isDirectory()) {
    const names = await readdir(full)
    for (const n of names) {
      await walk(path.join(full, n), `${rel}/${n}`, out)
    }
    return
  }
  out.push({
    full,
    relativePath: rel.replace(/\\/g, '/'),
    name: path.basename(full),
    size: s.size,
  })
}

const incoming = new Map<number, { stream: ReturnType<typeof createWriteStream>; dest: string; batchId?: string }>()
const batches = new Map<string, { roots: Set<string>; open: number; complete: boolean }>()

function batchOf(id: string) {
  let b = batches.get(id)
  if (!b) {
    b = { roots: new Set(), open: 0, complete: false }
    batches.set(id, b)
  }
  return b
}

function finishBatch(id: string) {
  const b = batches.get(id)
  if (!b || !b.complete || b.open > 0) return
  const roots = [...b.roots]
  batches.delete(id)
  if (roots.length) {
    setClipboardFiles(roots)
    log('clipboard files', roots.length)
  }
}

export async function beginIncoming(transferId: number, relativePath: string, toPath?: string, batchId?: string) {
  const base = toPath || dropDir()
  const rel = relativePath.replace(/^[\\/]+/, '').replace(/\\/g, '/')
  const dest = path.join(base, ...rel.split('/'))
  mkdirSync(path.dirname(dest), { recursive: true })
  const stream = createWriteStream(dest)
  incoming.set(transferId, { stream, dest, batchId })
  if (batchId) {
    const b = batchOf(batchId)
    b.open++
    const root = rel.includes('/') ? path.join(base, rel.split('/')[0]) : dest
    b.roots.add(root)
  }
  return dest
}

export function writeIncoming(transferId: number, chunk: Uint8Array) {
  incoming.get(transferId)?.stream.write(Buffer.from(chunk))
}

export async function endIncoming(transferId: number) {
  const rec = incoming.get(transferId)
  if (!rec) return null
  await new Promise<void>((resolve, reject) => rec.stream.end((err: Error | null | undefined) => (err ? reject(err) : resolve())))
  incoming.delete(transferId)
  if (rec.batchId) {
    const b = batches.get(rec.batchId)
    if (b) {
      b.open = Math.max(0, b.open - 1)
      finishBatch(rec.batchId)
    }
  }
  return rec.dest
}

export function completeBatch(batchId: string) {
  const b = batchOf(batchId)
  b.complete = true
  finishBatch(batchId)
}

export function abortIncoming(transferId: number) {
  const rec = incoming.get(transferId)
  if (!rec) return
  rec.stream.destroy()
  incoming.delete(transferId)
}
