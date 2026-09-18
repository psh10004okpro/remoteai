import os from 'node:os'

const impl =
  os.platform() === 'darwin' ? await import('./mac-clipboard.js') : await import('./clipboard-win.js')

export const markLocalClipboard = impl.markLocalClipboard
export const clipboardChanged = impl.clipboardChanged
export const getClipboard = impl.getClipboard
export const setClipboardText = impl.setClipboardText
export const setClipboardFiles = impl.setClipboardFiles
export const initClipboardSeq = impl.initClipboardSeq
