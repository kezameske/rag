# Stop Frontend Server
# Run from project root: powershell -File scripts/stop-frontend.ps1

$ErrorActionPreference = "Stop"

Write-Host "Stopping frontend server (port 5173)..." -ForegroundColor Yellow

$killed = $false

# Method 1: Get-NetTCPConnection (preferred)
try {
    $connections = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
    if ($connections) {
        $processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -ne 0 }
        foreach ($procId in $processIds) {
            $process = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if ($process) {
                Write-Host "  Killing process: $($process.ProcessName) (PID: $procId)" -ForegroundColor Red
                # Kill process tree (parent and all children)
                taskkill /PID $procId /T /F 2>$null
                $killed = $true
            }
        }
    }
} catch {
    Write-Host "  Get-NetTCPConnection failed, trying fallback..." -ForegroundColor Gray
}

# Method 2: Fallback using netstat if Method 1 didn't find anything
if (-not $killed) {
    $netstatOutput = netstat -ano | Select-String ":5173.*LISTENING"
    if ($netstatOutput) {
        foreach ($line in $netstatOutput) {
            $parts = $line -split '\s+'
            $procId = $parts[-1]
            if ($procId -and $procId -ne '0') {
                $process = Get-Process -Id $procId -ErrorAction SilentlyContinue
                if ($process) {
                    Write-Host "  Killing process: $($process.ProcessName) (PID: $procId)" -ForegroundColor Red
                    taskkill /PID $procId /T /F 2>$null
                    $killed = $true
                }
            }
        }
    }
}

# Verify it's stopped
Start-Sleep -Milliseconds 500
$stillRunning = netstat -ano | Select-String ":5173.*LISTENING"
if ($stillRunning) {
    Write-Host "WARNING: Frontend may still be running. Try running as Administrator." -ForegroundColor Red
    Write-Host $stillRunning -ForegroundColor Gray
} elseif ($killed) {
    Write-Host "Frontend server stopped." -ForegroundColor Green
} else {
    Write-Host "No frontend server running on port 5173." -ForegroundColor Cyan
}
