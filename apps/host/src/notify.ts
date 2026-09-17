import { exec } from 'node:child_process'
import { log } from './log.js'

export function notify(title: string, body: string) {
  const t = title.replace(/'/g, "''")
  const b = body.replace(/'/g, "''")
  exec(
    `powershell -NoProfile -WindowStyle Hidden -Command "try { Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(4000, '${t}', '${b}', [System.Windows.Forms.ToolTipIcon]::Info); Start-Sleep -Seconds 5; $n.Dispose() } catch { }"`,
    (err) => {
      if (err) log('notify', err)
    },
  )
}
