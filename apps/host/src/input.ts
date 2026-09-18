import os from 'node:os'
import type { SpecialKey } from '@remoteai/protocol'

const impl =
  os.platform() === 'darwin' ? await import('./mac-input.js') : await import('./input-win.js')

export const handleKey = impl.handleKey
export const handleMouse = impl.handleMouse
export const handleText = impl.handleText
export const handleSpecial = impl.handleSpecial as (key: SpecialKey) => void
export const resolveDisplay = impl.resolveDisplay
export const chord = impl.chord
export const listDisplaysWin = 'listDisplaysWin' in impl && impl.listDisplaysWin ? impl.listDisplaysWin : () => []
