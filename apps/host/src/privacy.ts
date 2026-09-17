import { spawn, type ChildProcess } from 'node:child_process'
import { log } from './log.js'

let proc: ChildProcess | null = null

export function setBlankScreen(on: boolean) {
  if (!on) {
    proc?.kill()
    proc = null
    return
  }
  if (proc) return
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$forms = @()
foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
  $f = New-Object System.Windows.Forms.Form
  $f.FormBorderStyle = 'None'
  $f.BackColor = [System.Drawing.Color]::Black
  $f.StartPosition = 'Manual'
  $f.Bounds = $s.Bounds
  $f.TopMost = $true
  $f.ShowInTaskbar = $false
  $f.Cursor = [System.Windows.Forms.Cursors]::None
  $f.Show()
  $forms += $f
}
while ($true) { Start-Sleep -Seconds 60 }
`
  proc = spawn('powershell', ['-NoProfile', '-STA', '-Command', ps], { windowsHide: true, stdio: 'ignore' })
  proc.on('exit', () => {
    proc = null
  })
  log('blank screen on')
}
