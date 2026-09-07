$ErrorActionPreference = "SilentlyContinue"
Stop-ScheduledTask -TaskName "MediumLatens"
Unregister-ScheduledTask -TaskName "MediumLatens" -Confirm:$false
Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe'" |
  Where-Object { $_.CommandLine -match "run-server\.cmd" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -match "windows\\\.\.\\server\.js" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Host "MediumLatens removido."
