$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$AppRoot = Join-Path $ProjectRoot 'camera_app'

function Stop-PortProcess {
    param([int]$Port)
    $connections = netstat -ano | Select-String ":$Port\s"
    $pids = @()
    foreach ($line in $connections) {
        if ($line.Line -match 'LISTENING\s+(\d+)$') {
            $pids += [int]$Matches[1]
        }
    }
    foreach ($processId in ($pids | Select-Object -Unique)) {
        if ($processId -gt 0) {
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        }
    }
}

Stop-PortProcess -Port 8010
Start-Sleep -Seconds 1

Start-Process `
    -WindowStyle Hidden `
    -FilePath python `
    -ArgumentList @('-m', 'uvicorn', 'backend.cpplus_helper:app', '--host', '0.0.0.0', '--port', '8010') `
    -WorkingDirectory $AppRoot

Start-Sleep -Seconds 4
Invoke-RestMethod -Uri 'http://127.0.0.1:8010/recording/status' | ConvertTo-Json -Depth 6
