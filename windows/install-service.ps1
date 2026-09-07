# Medium Latens - instala o servidor como tarefa de logon (rodar 1x como o proprio usuario)
$ErrorActionPreference = "Stop"
$vbs = Join-Path $PSScriptRoot "run-hidden.vbs"
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName "MediumLatens" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName "MediumLatens"
Start-Sleep -Seconds 2
try {
  $h = Invoke-RestMethod "http://127.0.0.1:8765/health" -TimeoutSec 5
  Write-Host "OK: servidor no ar - provider $($h.provider), perfil $($h.profile.label)"
  Write-Host "Logs em $env:APPDATA\Medium Latens\logs\"
} catch {
  Write-Host "Tarefa instalada, mas /health nao respondeu ainda. Veja $env:APPDATA\Medium Latens\logs\err.log"
}
