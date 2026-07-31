$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$AppRoot = Join-Path $ProjectRoot 'camera_app'
$FrontendRoot = Join-Path $AppRoot 'frontend'
$LogDir = Join-Path $ProjectRoot 'runtime_logs'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-MonitorLog {
    param([string]$Message)
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path (Join-Path $LogDir 'startup.log') -Value "[$stamp] $Message"
}

function Test-LocalPort {
    param([int]$Port)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(600, $false)) {
            return $false
        }
        $client.EndConnect($async)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Get-LanIp {
    $socket = $null
    try {
        $socket = New-Object System.Net.Sockets.Socket(
            [System.Net.Sockets.AddressFamily]::InterNetwork,
            [System.Net.Sockets.SocketType]::Dgram,
            [System.Net.Sockets.ProtocolType]::Udp
        )
        $socket.Connect('8.8.8.8', 80)
        $endpoint = [System.Net.IPEndPoint]$socket.LocalEndPoint
        if ($endpoint -and $endpoint.Address -and $endpoint.Address.ToString() -notlike '127.*') {
            return $endpoint.Address.ToString()
        }
    } catch {
        # Fall back to DNS below.
    } finally {
        if ($socket) {
            $socket.Close()
        }
    }

    try {
        $addresses = [System.Net.Dns]::GetHostEntry($env:COMPUTERNAME).AddressList |
            Where-Object {
                $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and
                $_.ToString() -notlike '127.*' -and
                $_.ToString() -notlike '169.254.*'
            }
        $first = $addresses | Select-Object -First 1
        if ($first) {
            return $first.ToString()
        }
    } catch {
        # Fall through to localhost.
    }
    return '127.0.0.1'
}

function Get-PythonExe {
    $preferred = 'C:\Program Files\Python314\python.exe'
    if (Test-Path $preferred) {
        return $preferred
    }
    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($python) {
        return $python.Source
    }
    $py = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($py) {
        return $py.Source
    }
    throw 'Python executable not found.'
}

function Get-NpmExe {
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($npm) {
        return $npm.Source
    }
    throw 'npm.cmd not found.'
}

$localHelperUrl = 'http://127.0.0.1:8010'
$env:VITE_HELPER_URL = $localHelperUrl
$env:BROWSER = 'none'
$ffmpegExe = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.2-full_build\bin\ffmpeg.exe'
if (Test-Path $ffmpegExe) {
    $env:FFMPEG_PATH = $ffmpegExe
    Write-MonitorLog "FFmpeg configured at $ffmpegExe"
} else {
    Write-MonitorLog 'FFmpeg not found in WinGet package path; backend will use PATH fallback.'
}
Write-MonitorLog "Startup check. Local-only helper=$env:VITE_HELPER_URL"

if (-not (Test-LocalPort -Port 8010)) {
    $pythonExe = Get-PythonExe
    Write-MonitorLog "Starting backend on port 8010 with $pythonExe"
    Start-Process `
        -WindowStyle Hidden `
        -FilePath $pythonExe `
        -ArgumentList @('backend\cpplus_helper.py') `
        -WorkingDirectory $AppRoot `
        -RedirectStandardOutput (Join-Path $LogDir 'backend.out.log') `
        -RedirectStandardError (Join-Path $LogDir 'backend.err.log')
} else {
    Write-MonitorLog 'Backend already running on port 8010.'
}

Start-Sleep -Seconds 2

if (-not (Test-LocalPort -Port 5174)) {
    $npmExe = Get-NpmExe
    Write-MonitorLog "Starting frontend on localhost port 5174 with helper $env:VITE_HELPER_URL"
    Start-Process `
        -WindowStyle Hidden `
        -FilePath $npmExe `
        -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1', '--port', '5174') `
        -WorkingDirectory $FrontendRoot `
        -RedirectStandardOutput (Join-Path $LogDir 'frontend.out.log') `
        -RedirectStandardError (Join-Path $LogDir 'frontend.err.log')
} else {
    Write-MonitorLog 'Frontend already running on port 5174.'
}

Write-MonitorLog 'Startup check complete.'
