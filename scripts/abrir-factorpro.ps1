$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot 'backend'
$flaskExe = Join-Path $backendDir '.venv\Scripts\flask.exe'
$url = 'http://127.0.0.1:5000'
$healthUrl = "$url/api/health"

if (-not (Test-Path $flaskExe)) {
  throw "Ambiente do backend não encontrado em '$flaskExe'. Consulte o README para configurar o projeto."
}

$serverReady = $false
try {
  $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3
  $serverReady = $health.status -eq 'ok'
} catch {
  $serverReady = $false
}

if (-not $serverReady) {
  $listener = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue
  if ($listener) {
    throw "A porta 5000 está ocupada, mas não responde como FACTOR PRO. Feche o processo que a utiliza e tente novamente."
  }

  $logDir = Join-Path $repoRoot 'logs'
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $stdout = Join-Path $logDir 'factorpro-server.log'
  $stderr = Join-Path $logDir 'factorpro-server-error.log'

  Start-Process `
    -FilePath $flaskExe `
    -ArgumentList @('run', '--host', '127.0.0.1', '--port', '5000', '--no-reload') `
    -WorkingDirectory $backendDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr | Out-Null

  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Seconds 1
    try {
      $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
      if ($health.status -eq 'ok') {
        $serverReady = $true
        break
      }
    } catch {
      $serverReady = $false
    }
  }
}

if (-not $serverReady) {
  throw "O FACTOR PRO não iniciou em 30 segundos. Consulte '$stderr' e '$stdout' para ver o erro."
}

Start-Process $url
Write-Output "FACTOR PRO aberto no navegador padrão: $url"
