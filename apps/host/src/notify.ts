import { exec } from 'node:child_process'
import { log } from './log.js'

export function notify(title: string, body: string) {
  if (process.platform === 'darwin') {
    const t = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const b = body.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    exec(`osascript -e 'display notification "${b}" with title "${t}"'`, (err) => {
      if (err) log('notify', err)
    })
    return
  }
  const t = title.replace(/'/g, "''")
  const b = body.replace(/'/g, "''")
  exec(
    `powershell -NoProfile -WindowStyle Hidden -Command "try { Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(4000, '${t}', '${b}', [System.Windows.Forms.ToolTipIcon]::Info); Start-Sleep -Seconds 5; $n.Dispose() } catch { }"`,
    (err) => {
      if (err) log('notify', err)
    },
  )
}
