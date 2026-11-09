param(
  [ValidateRange(1, 300)]
  [int]$StartupTimeoutSeconds = 60,
  [ValidateRange(1, 65535)]
  [int]$Port = 8799,
  [ValidateRange(1, 65535)]
  [int]$UiPort = 5199,
  [string]$DataDir
)

$ErrorActionPreference = "Stop"
$pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
if (-not $pnpm) {
  $pnpm = Get-Command pnpm -ErrorAction Stop
}

function Start-DevProcess([string]$script) {
  Start-Process -FilePath $pnpm.Source -ArgumentList $script -WorkingDirectory $PSScriptRoot -NoNewWindow -PassThru
}

function Stop-DevProcess([System.Diagnostics.Process]$process) {
  if (-not $process.HasExited) {
    & taskkill.exe /pid $process.Id /t /f 2>$null | Out-Null
  }
}

function Restore-Environment([string]$name, [AllowNull()][string]$value) {
  if ($null -eq $value) {
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
  } else {
    Set-Item "Env:$name" $value
  }
}

$previousPort = $env:OMB_PORT
$previousUiPort = $env:OMB_UI_PORT
$previousStartUrl = $env:ELECTRON_START_URL
$previousDataDir = $env:OMB_DATA_DIR
$env:OMB_PORT = "$Port"
$env:OMB_UI_PORT = "$UiPort"
$env:ELECTRON_START_URL = "http://127.0.0.1:$UiPort"
if ($DataDir) {
  $env:OMB_DATA_DIR = $DataDir
}

$server = $null
$ui = $null
$desktop = $null

try {
  $server = Start-DevProcess "dev:server"
  $ui = Start-DevProcess "dev"
  $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
  do {
    if ($ui.HasExited) {
      throw "The Vite development server exited before it became ready."
    }
    try {
      Invoke-WebRequest -Uri "http://127.0.0.1:$UiPort" -UseBasicParsing -TimeoutSec 2 | Out-Null
      break
    } catch {
      Start-Sleep -Milliseconds 250
    }
  } while ((Get-Date) -lt $deadline)

  if ((Get-Date) -ge $deadline) {
    throw "The Vite development server did not become ready within $StartupTimeoutSeconds seconds."
  }

  $desktop = Start-DevProcess "dev:desktop"
  $desktop.WaitForExit()
} finally {
  if ($desktop) { Stop-DevProcess $desktop }
  if ($ui) { Stop-DevProcess $ui }
  if ($server) { Stop-DevProcess $server }
  Restore-Environment "OMB_PORT" $previousPort
  Restore-Environment "OMB_UI_PORT" $previousUiPort
  Restore-Environment "ELECTRON_START_URL" $previousStartUrl
  Restore-Environment "OMB_DATA_DIR" $previousDataDir
}
