# Medium Latens: instalacao no Windows. Idempotente.
param([string]$AppDir = "$env:LOCALAPPDATA\Programs\Medium Latens")
$ErrorActionPreference = "Continue"
$VersoesArq = Join-Path $AppDir "installer\versoes.env"
if (-not (Test-Path -LiteralPath $VersoesArq)) {
  Write-Host "FALHOU: Nao encontrei $VersoesArq"
  exit 1
}
foreach ($linha in [System.IO.File]::ReadAllLines($VersoesArq, [System.Text.Encoding]::ASCII)) {
  if ($linha -match '^([A-Z0-9_]+)=([^\s]+)$') {
    Set-Variable -Name $Matches[1] -Value $Matches[2]
  }
}
foreach ($nomeVersao in "CLAUDE_CODE","CODEX","GEMINI_CLI","PREMIERE_PRO_MCP","FFPROBE_STATIC","FFMPEG_STATIC_TAG","FFMPEG_SHA256_DARWIN_ARM64","FFMPEG_SHA256_DARWIN_X64","FFMPEG_SHA256_WIN32_X64") {
  if ([string]::IsNullOrWhiteSpace((Get-Variable -Name $nomeVersao -ValueOnly -ErrorAction SilentlyContinue))) {
    Write-Host "FALHOU: Versao obrigatoria ausente em $VersoesArq"
    exit 1
  }
}
$UserDir = if ($env:MEDIUM_LATENS_USER_DIR) { $env:MEDIUM_LATENS_USER_DIR } else { "$env:APPDATA\Medium Latens" }
$Log = "$UserDir\logs\install.log"
$NpmPrefix = "$UserDir\npm"
try {
  New-Item -ItemType Directory -Force -Path "$UserDir\logs","$UserDir\workspaces","$UserDir\data" -ErrorAction Stop | Out-Null
} catch {
  Write-Host "FALHOU: Nao consegui criar a pasta de configuracao $UserDir"
  exit 1
}
$Total = 8

function Passo($n, $txt) {
  $m = "PASSO $n/$Total`: $txt"
  Write-Host $m
  Add-Content $Log $m
}

function Falha($txt) {
  Add-Content $Log "FALHOU: $txt"
  Write-Host "FALHOU: $txt"
  Write-Host "Log em $Log"
  exit 1
}

function Aviso($txt) {
  Add-Content $Log "AVISO: $txt"
  Write-Host "AVISO: $txt"
}

function Limpar-SegredosNpm {
  $nomes = [System.Environment]::GetEnvironmentVariables("Process").Keys
  $nomesFixos = @(
    "NODE_OPTIONS",
    "NODE_EXTRA_CA_CERTS",
    "FFMPEG_BINARIES_URL",
    "FFMPEG_BINARY_RELEASE",
    "NPM_TOKEN",
    "NODE_AUTH_TOKEN"
  )
  foreach ($nome in $nomes) {
    $nomeTexto = [string]$nome
    $remover = $nomeTexto -match '^(?i:npm_config_)' -or $nomeTexto -match '(?i:_API_KEY)$'
    if (-not $remover) {
      foreach ($nomeFixo in $nomesFixos) {
        if ($nomeTexto.Equals($nomeFixo, [System.StringComparison]::OrdinalIgnoreCase)) {
          $remover = $true
          break
        }
      }
    }
    if ($remover) {
      [System.Environment]::SetEnvironmentVariable($nomeTexto, $null, "Process")
    }
  }
}

function Instalar-NpmGlobal([string]$pacote, [switch]$IgnorarScripts) {
  Limpar-SegredosNpm
  $env:npm_config_prefix = $NpmPrefix
  $argumentosNpm = @("install", "-g")
  if ($IgnorarScripts) { $argumentosNpm += "--ignore-scripts" }
  $argumentosNpm += $pacote
  & npm @argumentosNpm *>> $Log
  return $LASTEXITCODE
}

Passo 1 "Preparando os arquivos do programa"
if (-not (Test-Path "$AppDir\server.js")) { Falha "Arquivos do programa nao encontrados em $AppDir" }

Passo 2 "Verificando o Node.js"
$temNode = $false
try {
  $v = (& node -p "process.versions.node.split('.')[0]" 2>$null)
  if ([int]$v -ge 22) { $temNode = $true }
} catch {}
if (-not $temNode) {
  $zip = "$env:TEMP\medium-latens-node.zip"
  $extraido = Join-Path $env:TEMP ("medium-latens-node-" + [guid]::NewGuid().ToString("N"))
  $nodeDirPadrao = "$env:LOCALAPPDATA\Programs\nodejs"
  $nodeDirAlternativo = "$env:LOCALAPPDATA\Programs\nodejs-medium-latens"
  $marcadorNodePadrao = "$nodeDirPadrao\.medium-latens-instalou"
  if ((Test-Path -LiteralPath $nodeDirPadrao) -and -not (Test-Path -LiteralPath $marcadorNodePadrao)) {
    $dir = $nodeDirAlternativo
  }
  else {
    $dir = $nodeDirPadrao
  }
  $marcadorNode = "$dir\.medium-latens-instalou"
  $motivoFalhaNode = $null
  try {
    $idx = Invoke-RestMethod "https://nodejs.org/dist/index.json" -ErrorAction Stop
    $lts = ($idx | Where-Object { $_.lts } | Select-Object -First 1).version
    if (-not $lts) { Falha "Nao consegui descobrir a versao do Node.js. Verifique sua conexao." }
    $archRaw = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $arch = if ($archRaw -eq "ARM64") { "arm64" } else { "x64" }
    $pastaInterna = "node-$lts-win-$arch"
    Remove-Item -Force $zip -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $extraido -ErrorAction Stop | Out-Null
    $ProgressPreference = "SilentlyContinue"
    Invoke-WebRequest "https://nodejs.org/dist/$lts/$pastaInterna.zip" -OutFile $zip -ErrorAction Stop
    # Integridade: a lista oficial de somas do mesmo release tem que citar este zip e bater.
    $listaSomas = (Invoke-WebRequest "https://nodejs.org/dist/$lts/SHASUMS256.txt" -UseBasicParsing -ErrorAction Stop).Content
    $padraoSoma = '^\s*([0-9a-fA-F]{64})\s+' + [regex]::Escape("$pastaInterna.zip") + '\s*$'
    $somaEsperada = $null
    foreach ($linhaSoma in ($listaSomas -split "`r?`n")) {
      if ($linhaSoma -match $padraoSoma) { $somaEsperada = $Matches[1].ToLower(); break }
    }
    if (-not $somaEsperada) {
      $motivoFalhaNode = "A lista de verificacao do Node.js nao menciona $pastaInterna.zip"
      throw "soma-ausente"
    }
    $somaObtida = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
    if ($somaObtida -ne $somaEsperada) {
      $motivoFalhaNode = "O Node.js baixado nao confere com a verificacao oficial. Tente de novo mais tarde."
      throw "soma-diferente"
    }
    Add-Content $Log "Node.js $lts verificado (SHA-256 confere)"
    Expand-Archive -Path $zip -DestinationPath $extraido -Force -ErrorAction Stop
    if (-not (Test-Path "$extraido\$pastaInterna\node.exe")) { throw "node.exe" }
    New-Item -ItemType Directory -Force -Path (Split-Path $dir -Parent) -ErrorAction Stop | Out-Null
    if ((Test-Path -LiteralPath $dir) -and -not (Test-Path -LiteralPath $marcadorNode)) {
      $motivoFalhaNode = "A pasta $dir ja existe e nao pertence ao Medium Latens"
      throw "diretorio-nao-marcado"
    }
    if (Test-Path -LiteralPath $marcadorNode) {
      Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction Stop
    }
    Move-Item "$extraido\$pastaInterna" $dir -ErrorAction Stop
    Remove-Item -Recurse -Force $extraido -ErrorAction SilentlyContinue
    Remove-Item -Force $zip -ErrorAction SilentlyContinue

    $caminhoUsuario = [Environment]::GetEnvironmentVariable("Path", "User")
    $entradasUsuario = @($caminhoUsuario -split ";" | Where-Object { $_ })
    if ($entradasUsuario -notcontains $dir) {
      $novoCaminho = if ([string]::IsNullOrWhiteSpace($caminhoUsuario)) { $dir } else { "$dir;$caminhoUsuario" }
      [Environment]::SetEnvironmentVariable("Path", $novoCaminho, "User")
    }
    $entradasSessao = @($env:Path -split ";" | Where-Object { $_ })
    if ($entradasSessao -notcontains $dir) { $env:Path = "$dir;$env:Path" }
  } catch {
    Remove-Item -Recurse -Force $extraido -ErrorAction SilentlyContinue
    Remove-Item -Force $zip -ErrorAction SilentlyContinue
    if ($motivoFalhaNode) { Falha $motivoFalhaNode } else { Falha "A instalacao do Node.js falhou" }
  }
  Set-Content $marcadorNode "Medium Latens" -ErrorAction SilentlyContinue
  if (-not (Test-Path $marcadorNode)) { Aviso "Nao consegui gravar o marcador da instalacao do Node.js" }
}

$caminhoUsuarioNpm = [Environment]::GetEnvironmentVariable("Path", "User")
$entradasUsuarioNpm = @($caminhoUsuarioNpm -split ";" | Where-Object { $_ })
if ($entradasUsuarioNpm -notcontains $NpmPrefix) {
  $novoCaminhoNpm = if ([string]::IsNullOrWhiteSpace($caminhoUsuarioNpm)) { $NpmPrefix } else { "$NpmPrefix;$caminhoUsuarioNpm" }
  [Environment]::SetEnvironmentVariable("Path", $novoCaminhoNpm, "User")
}
$entradasSessaoNpm = @($env:Path -split ";" | Where-Object { $_ })
if ($entradasSessaoNpm -notcontains $NpmPrefix) { $env:Path = "$NpmPrefix;$env:Path" }

Passo 3 "Instalando os componentes de IA"
$codigo = Instalar-NpmGlobal "@anthropic-ai/claude-code@$CLAUDE_CODE"
if ($codigo -ne 0) { Aviso "Claude CLI nao instalou" }
$codigo = Instalar-NpmGlobal "@openai/codex@$CODEX"
if ($codigo -ne 0) { Aviso "Codex CLI nao instalou" }
$codigo = Instalar-NpmGlobal "premiere-pro-mcp@$PREMIERE_PRO_MCP" -IgnorarScripts
if ($codigo -ne 0) { Falha "O componente que fala com o Premiere nao instalou" }
if (-not (Get-Command claude -ErrorAction SilentlyContinue) -and -not (Get-Command codex -ErrorAction SilentlyContinue)) {
  Falha "Nenhum assistente de IA pode ser instalado"
}
$codigo = Instalar-NpmGlobal "@google/gemini-cli@$GEMINI_CLI"
if ($codigo -ne 0) { Aviso "Gemini CLI nao instalou" }

Passo 4 "Preparando o motor de transcricao e cortes (opcional, pode demorar)"
try {
  $py = Get-Command python -ErrorAction SilentlyContinue
  if (-not $py) { $py = Get-Command py -ErrorAction SilentlyContinue }
  if (-not $py) { throw "python" }
  & $py.Source -m venv "$UserDir\venv" *>> $Log
  if ($LASTEXITCODE -ne 0) { throw "venv" }
  & "$UserDir\venv\Scripts\pip.exe" install --quiet --upgrade pip *>> $Log
  if ($LASTEXITCODE -ne 0) { throw "pip" }
  & "$UserDir\venv\Scripts\pip.exe" install --quiet -r "$AppDir\engine\requirements.txt" *>> $Log
  if ($LASTEXITCODE -ne 0) { throw "pip" }
  $codigo = Instalar-NpmGlobal "ffprobe-static@$FFPROBE_STATIC" -IgnorarScripts
  if ($codigo -ne 0) { throw "ffprobe" }
  Limpar-SegredosNpm
  $env:npm_config_prefix = $NpmPrefix
  $raizNpm = [string]((& npm root -g 2>> $Log) | Select-Object -Last 1)
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raizNpm)) { throw "npm-root" }
  # Windows 11 on ARM runs x64 executables. This release has no native ARM64 assets.
  $midiaArch = "x64"
  New-Item -ItemType Directory -Force -Path "$UserDir\bin" -ErrorAction Stop | Out-Null
  Copy-Item "$raizNpm\ffprobe-static\bin\win32\$midiaArch\ffprobe.exe" "$UserDir\bin\ffprobe.exe" -Force -ErrorAction Stop
  $ffmpegDestino = "$UserDir\bin\ffmpeg.exe"
  $ffmpegTemp = "$UserDir\bin\.ffmpeg.download"
  $ffmpegEsperada = $FFMPEG_SHA256_WIN32_X64.ToLower()
  $ffmpegJaValido = $false
  if (Test-Path -LiteralPath $ffmpegDestino) {
    try {
      $ffmpegExistente = (Get-FileHash -Algorithm SHA256 -Path $ffmpegDestino -ErrorAction Stop).Hash.ToLower()
      if ($ffmpegExistente -eq $ffmpegEsperada) { $ffmpegJaValido = $true }
    } catch {}
  }
  if (-not $ffmpegJaValido) {
    Remove-Item -LiteralPath $ffmpegTemp -Force -ErrorAction SilentlyContinue
    try {
      $ffmpegUrl = "https://github.com/eugeneware/ffmpeg-static/releases/download/$FFMPEG_STATIC_TAG/ffmpeg-win32-x64"
      $ProgressPreference = "SilentlyContinue"
      Invoke-WebRequest $ffmpegUrl -OutFile $ffmpegTemp -ErrorAction Stop
      $ffmpegObtida = (Get-FileHash -Algorithm SHA256 -Path $ffmpegTemp).Hash.ToLower()
      if ($ffmpegObtida -ne $ffmpegEsperada) {
        Remove-Item -LiteralPath $ffmpegTemp -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $ffmpegDestino -Force -ErrorAction SilentlyContinue
        Aviso "O ffmpeg baixado nao confere com SHA-256 oficial. O restante do app funciona normalmente."
      }
      else {
        Move-Item $ffmpegTemp $ffmpegDestino -Force -ErrorAction Stop
      }
    }
    catch {
      Remove-Item -LiteralPath $ffmpegTemp -Force -ErrorAction SilentlyContinue
      Aviso "Nao consegui baixar o ffmpeg verificado. O restante do app funciona normalmente."
    }
  }
} catch {
  Aviso "Motor de cortes indisponivel. O restante do app funciona normalmente."
}

Passo 5 "Instalando o painel dentro do Premiere"
try {
  if (-not $env:APPDATA) { Falha "APPDATA nao definido" }
  $Dest = "$env:APPDATA\Adobe\CEP\extensions\MediumLatens"
  Remove-Item -Recurse -Force $Dest -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $Dest -ErrorAction Stop | Out-Null
  Copy-Item "$AppDir\panel\*" $Dest -Recurse -Force -ErrorAction Stop
  if (-not (Test-Path "$Dest\index.html")) { throw "painel" }
  $debugMarker = Join-Path $UserDir "cep-debug-ativado"
  foreach ($v in 9,10,11,12) {
    $debugAtual = & reg query "HKCU\Software\Adobe\CSXS.$v" /v PlayerDebugMode 2>$null
    $debugQueryExit = $LASTEXITCODE
    $debugJaAtivo = $debugQueryExit -eq 0 -and ([string]($debugAtual -join "`n")) -match 'PlayerDebugMode\s+REG_\w+\s+1(?:\s|$)'
    if (-not $debugJaAtivo) {
      reg add "HKCU\Software\Adobe\CSXS.$v" /v PlayerDebugMode /t REG_SZ /d 1 /f *>> $Log
      if ($LASTEXITCODE -ne 0) {
        Aviso "Nao consegui habilitar o modo de depuracao do painel no CSXS $v"
      }
      else {
        $debugRegistrado = (Test-Path -LiteralPath $debugMarker) -and ((Get-Content -LiteralPath $debugMarker) -contains [string]$v)
        if (-not $debugRegistrado) { Add-Content -LiteralPath $debugMarker -Value $v -Encoding ASCII }
      }
    }
  }
} catch {
  Falha "Nao consegui instalar o painel"
}

Passo 6 "Configurando a inicializacao automatica"
try {
  & powershell -ExecutionPolicy Bypass -File "$AppDir\windows\install-service.ps1" *>> $Log
  if ($LASTEXITCODE -ne 0) { throw "servico" }
} catch {
  Falha "Nao consegui configurar a inicializacao"
}

Passo 7 "Criando sua pasta de configuracao"
try {
  if (-not (Test-Path "$UserDir\.env")) {
    Set-Content "$UserDir\.env" "# Chaves opcionais, para gerar imagem e voz. O assistente do painel preenche isto para voce.`n# GEMINI_API_KEY=`n# ELEVENLABS_API_KEY=" -ErrorAction Stop
  }
  if (-not (Test-Path "$UserDir\hotwords.txt")) {
    Set-Content "$UserDir\hotwords.txt" "# Um termo por linha: nomes e jargoes do seu canal." -ErrorAction Stop
  }
  if (-not (Test-Path "$UserDir\.env") -or -not (Test-Path "$UserDir\hotwords.txt")) { throw "configuracao" }
} catch {
  Falha "Nao consegui criar a pasta de configuracao"
}
$env:MEDIUM_LATENS_USER_DIR = $UserDir
try {
  $caminhoTermos = "$AppDir\TERMOS.md"
  $textoTermos = [System.IO.File]::ReadAllText($caminhoTermos, [System.Text.Encoding]::UTF8)
  $primeiraLinhaTermos = ($textoTermos -split "\r?\n", 2)[0]
  $matchTermos = [regex]::Match($primeiraLinhaTermos, '\(vers.{1,2}o ([0-9.]+)\)')
  if (-not $matchTermos.Success) { throw "versao-termos" }
  $VersaoTermos = $matchTermos.Groups[1].Value
  if ([string]::IsNullOrWhiteSpace($VersaoTermos)) { throw "versao-termos" }
  & node -e "require(process.argv[1] + '/lib/telemetria').registrarAceite(process.argv[2])" $AppDir $VersaoTermos *>> $Log
  if ($LASTEXITCODE -ne 0) { throw "aceite" }
} catch {
  Falha "Nao consegui registrar o aceite dos termos"
}

Passo 8 "Conferindo se esta no ar"
for ($i = 1; $i -le 15; $i++) {
  Start-Sleep -Seconds 1
  try {
    Invoke-RestMethod "http://127.0.0.1:8765/health" -TimeoutSec 3 -ErrorAction Stop | Out-Null
    Add-Content $Log "PRONTO"
    Write-Host "PRONTO"
    exit 0
  } catch {}
}
Falha "O servico nao respondeu. Veja $UserDir\logs\err.log."
