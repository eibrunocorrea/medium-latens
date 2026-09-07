param([string]$AppDir = "$env:LOCALAPPDATA\Programs\Medium Latens")

$ErrorActionPreference = "SilentlyContinue"
$falhas = 0
$nodeRemovido = $false

function Add-Failure {
    param([string]$Message)
    Write-Warning $Message
    $script:falhas += 1
}

$userDir = $null
if (-not [string]::IsNullOrWhiteSpace($env:MEDIUM_LATENS_USER_DIR)) {
    $userDir = $env:MEDIUM_LATENS_USER_DIR
}
elseif (-not [string]::IsNullOrWhiteSpace($env:APPDATA)) {
    $userDir = Join-Path $env:APPDATA "Medium Latens"
}

$appLeaf = Split-Path -Leaf $AppDir.TrimEnd("\", "/")
$appDirSafe = -not [string]::IsNullOrWhiteSpace($AppDir) -and $appLeaf -eq "Medium Latens"
if ($appDirSafe -and $null -ne $userDir) {
    try {
        $appFull = [System.IO.Path]::GetFullPath($AppDir).TrimEnd("\", "/")
        $userFull = [System.IO.Path]::GetFullPath($userDir).TrimEnd("\", "/")
    }
    catch {
        $appDirSafe = $false
    }
    $comparison = [System.StringComparison]::OrdinalIgnoreCase
    $separator = [System.IO.Path]::DirectorySeparatorChar
    if ($appDirSafe -and (
        $appFull.Equals($userFull, $comparison) -or
        $appFull.StartsWith($userFull + $separator, $comparison) -or
        $userFull.StartsWith($appFull + $separator, $comparison)
    )) {
        $appDirSafe = $false
    }
}

if (-not $appDirSafe) {
    Write-Warning "Caminho do programa recusado pela protecao do desinstalador: $AppDir"
    Write-Host "A desinstalacao nao terminou: veja o aviso acima."
    if ($null -ne $userDir) {
        Write-Host "Suas contas, chaves, projetos e o motor de cortes continuam em $userDir."
    }
    exit 1
}

$serviceUninstaller = Join-Path $AppDir "windows\uninstall-service.ps1"
if (Test-Path -LiteralPath $serviceUninstaller) {
    & powershell -ExecutionPolicy Bypass -File $serviceUninstaller
    if ($LASTEXITCODE -ne 0) {
        Add-Failure "Nao consegui parar o servico do Medium Latens."
    }
}

if (-not [string]::IsNullOrWhiteSpace($env:APPDATA)) {
    $panelDir = Join-Path $env:APPDATA "Adobe\CEP\extensions\MediumLatens"
    if (Test-Path -LiteralPath $panelDir) {
        Remove-Item -LiteralPath $panelDir -Recurse -Force
        if (Test-Path -LiteralPath $panelDir) {
            Add-Failure "Nao consegui remover $panelDir"
        }
    }
}

if ($null -ne $userDir) {
    $debugMarker = Join-Path $userDir "cep-debug-ativado"
    if (Test-Path -LiteralPath $debugMarker) {
        foreach ($v in (Get-Content -LiteralPath $debugMarker)) {
            if ([string]$v -match '^(9|10|11|12)$') {
                & reg delete "HKCU\Software\Adobe\CSXS.$v" /v PlayerDebugMode /f 2>$null | Out-Null
            }
        }
    }
}

if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $nodeDirs = @(
        (Join-Path $env:LOCALAPPDATA "Programs\nodejs"),
        (Join-Path $env:LOCALAPPDATA "Programs\nodejs-medium-latens")
    )
    foreach ($nodeDir in $nodeDirs) {
        $nodeMarker = Join-Path $nodeDir ".medium-latens-instalou"
        if (Test-Path -LiteralPath $nodeMarker) {
            Remove-Item -LiteralPath $nodeDir -Recurse -Force
            if (Test-Path -LiteralPath $nodeDir) {
                Add-Failure "Nao consegui remover o Node.js instalado pelo Medium Latens."
            }
            else {
                $pathUsuario = [Environment]::GetEnvironmentVariable("Path", "User")
                $nodeNormalizado = $nodeDir.TrimEnd("\", "/")
                $entradasUsuario = @($pathUsuario -split ";" | Where-Object {
                    $_ -and -not $_.TrimEnd("\", "/").Equals(
                        $nodeNormalizado,
                        [System.StringComparison]::OrdinalIgnoreCase
                    )
                })
                $novoPathUsuario = $entradasUsuario -join ";"
                [Environment]::SetEnvironmentVariable("Path", $novoPathUsuario, "User")
                $nodeRemovido = $true
            }
        }
    }
}

if ($null -ne $userDir) {
    $npmPrefix = Join-Path $userDir "npm"
    $pathUsuario = [Environment]::GetEnvironmentVariable("Path", "User")
    $npmNormalizado = $npmPrefix.TrimEnd("\", "/")
    $entradasUsuario = @($pathUsuario -split ";" | Where-Object {
        $_ -and -not $_.TrimEnd("\", "/").Equals(
            $npmNormalizado,
            [System.StringComparison]::OrdinalIgnoreCase
        )
    })
    $novoPathUsuario = $entradasUsuario -join ";"
    [Environment]::SetEnvironmentVariable("Path", $novoPathUsuario, "User")
}

$innoUninstaller = Join-Path $AppDir "unins000.exe"
if (Test-Path -LiteralPath $innoUninstaller) {
    $process = Start-Process -FilePath $innoUninstaller -ArgumentList "/SILENT" -Wait -PassThru
    if ($null -eq $process -or $process.ExitCode -ne 0) {
        Add-Failure "O desinstalador do programa terminou com erro."
    }
}
else {
    if (Test-Path -LiteralPath $AppDir) {
        Remove-Item -LiteralPath $AppDir -Recurse -Force
        if (Test-Path -LiteralPath $AppDir) {
            Add-Failure "Nao consegui remover $AppDir"
        }
    }
}

if ($falhas -eq 0) {
    Write-Host "Programa removido."
    $exitCode = 0
}
else {
    Write-Host "A desinstalacao nao terminou: veja os avisos acima."
    $exitCode = 1
}
Write-Host "Suas contas, chaves, projetos e o motor de cortes continuam em $userDir."
if ($nodeRemovido) {
    Write-Host "O Node.js instalado pelo Medium Latens foi removido."
}
else {
    Write-Host "O Node.js por usuario foi mantido porque nao havia marcador desta instalacao."
}
Write-Host "Os CLIs fixados continuam em $userDir\npm, dentro da pasta preservada."
Write-Host "Para apagar tambem esses dados, remova essa pasta manualmente."
exit $exitCode
