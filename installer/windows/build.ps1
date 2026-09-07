param([string]$Versao)

$ErrorActionPreference = "Stop"
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Temporario = Join-Path ([System.IO.Path]::GetTempPath()) ("medium-latens-build-" + [guid]::NewGuid().ToString("N"))

try {
  New-Item -ItemType Directory -Path $Temporario -ErrorAction Stop | Out-Null
  $Zip = Join-Path $Temporario "fonte.zip"
  $Origem = Join-Path $Temporario "fonte"

  Push-Location $Raiz
  try {
    & git archive --format=zip HEAD -o $Zip
    if ($LASTEXITCODE -ne 0) { throw "git archive falhou" }
  } finally {
    Pop-Location
  }

  Expand-Archive -Path $Zip -DestinationPath $Origem -Force -ErrorAction Stop
  $TermosStage = Join-Path $Origem "TERMOS.md"
  $texto = [System.IO.File]::ReadAllText($TermosStage, [System.Text.Encoding]::UTF8)
  [System.IO.File]::WriteAllText($TermosStage, $texto, (New-Object System.Text.UTF8Encoding $true))
  # Carimbo de build oficial: só existe dentro do instalador, nunca num checkout do fonte (lib/build.js).
  $Commit = (& git -C $Raiz rev-parse --short HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $Commit) { throw "git rev-parse falhou" }
  $DataBuild = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  $Carimbo = "{`"oficial`": true, `"data`": `"$DataBuild`", `"commit`": `"$Commit`"}`n"
  [System.IO.File]::WriteAllText((Join-Path $Origem "BUILD"), $Carimbo, (New-Object System.Text.UTF8Encoding $false))
  $VersaoCommit = (Get-Content (Join-Path $Origem "VERSION") -Raw -ErrorAction Stop).Trim()
  if ($Versao -and $Versao -ne $VersaoCommit) {
    throw "A versao informada nao corresponde ao commit: $VersaoCommit"
  }
  $Versao = $VersaoCommit

  $IsccPadrao = if (${env:ProgramFiles(x86)}) {
    Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"
  } else {
    $null
  }
  $Iscc = if ($env:ISCC) { $env:ISCC } else { $IsccPadrao }
  if (-not $Iscc -or -not (Test-Path $Iscc)) {
    throw "ISCC.exe nao encontrado. Instale o Inno Setup 6 ou defina ISCC."
  }

  $Iss = Join-Path $Raiz "installer\windows\medium-latens.iss"
  & $Iscc "/DOrigem=$Origem" $Iss
  if ($LASTEXITCODE -ne 0) { throw "ISCC.exe falhou" }

  $Saida = Join-Path $Raiz "dist\Medium-Latens-Setup-$Versao.exe"
  if (-not (Test-Path $Saida)) { throw "O instalador nao foi gerado em $Saida" }
  Write-Output $Saida
} catch {
  Write-Error "Falha: $($_.Exception.Message)"
  exit 1
} finally {
  Remove-Item -Recurse -Force $Temporario -ErrorAction SilentlyContinue
}
