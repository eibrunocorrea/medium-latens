param([switch]$Simular)

$UserDir = if ($env:MEDIUM_LATENS_USER_DIR) { $env:MEDIUM_LATENS_USER_DIR } else { "$env:APPDATA\Medium Latens" }
$Porta = if ($env:MEDIUM_LATENS_PORTA) { $env:MEDIUM_LATENS_PORTA } else { "8765" }
$Health = "http://127.0.0.1:$Porta/health"
$Saudavel = $false

function Testar-Health {
  try {
    Invoke-RestMethod $Health -TimeoutSec 2 -ErrorAction Stop | Out-Null
    return $true
  } catch {
    return $false
  }
}

$Saudavel = Testar-Health
if (-not $Saudavel -and -not $Simular) {
  try {
    Start-ScheduledTask -TaskName "MediumLatens" -ErrorAction Stop
  } catch {}

  for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Seconds 1
    if (Testar-Health) {
      $Saudavel = $true
      break
    }
  }
}

$TokenFile = Join-Path $UserDir "token"
if ($Saudavel -and (Test-Path $TokenFile)) {
  $Token = [System.IO.File]::ReadAllText($TokenFile).Trim()
  $Url = "http://127.0.0.1:$Porta/status?t=$Token"
  $Alvo = Join-Path $UserDir "status-abrir.html"
  $Html = "<!doctype html><meta charset=`"utf-8`"><meta http-equiv=`"refresh`" content=`"0;url=$Url`">"
  [System.IO.File]::WriteAllText($Alvo, $Html, (New-Object System.Text.UTF8Encoding $false))
  if ($PSVersionTable.PSEdition -eq "Core" -and $PSVersionTable.Platform -eq "Unix") {
    try {
      [System.IO.File]::SetUnixFileMode($Alvo, [System.IO.UnixFileMode]::UserRead -bor [System.IO.UnixFileMode]::UserWrite)
    } catch {}
  }
} else {
  $Alvo = Join-Path $PSScriptRoot "index.html"
}

if ($Simular) {
  Write-Output $Alvo
  exit 0
}

Start-Process $Alvo
exit 0
