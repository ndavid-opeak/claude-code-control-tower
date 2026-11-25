# Registers a Task Scheduler task that starts claude-code-control-tower when you log in
# and restarts it if it stops. Run from the repo folder, after `npm install`:
#   powershell -ExecutionPolicy Bypass -File autostart\windows\install-task.ps1
# Remove with:
#   Unregister-ScheduledTask -TaskName claude-code-control-tower -Confirm:$false

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$node = (Get-Command node).Source
$tsx = Join-Path $repo 'node_modules\tsx\dist\cli.mjs'
if (-not (Test-Path $tsx)) { throw "Run 'npm install' in $repo first." }
$logDir = Join-Path $env:USERPROFILE '.claude-router'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'router.log'

# cmd.exe redirects output to the log; the task's PATH is your user PATH, so claude is found the same way as in a new terminal.
$action = New-ScheduledTaskAction -Execute 'cmd.exe' `
  -Argument "/c `"`"$node`" `"$tsx`" src\server.ts >> `"$log`" 2>&1`"" `
  -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName 'claude-code-control-tower' -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Local router and Sessions board for Claude Code' -Force | Out-Null
Start-ScheduledTask -TaskName 'claude-code-control-tower'
Write-Host "Registered and started. Check: curl.exe -s -o NUL -w '%{http_code}' http://127.0.0.1:3456/"
