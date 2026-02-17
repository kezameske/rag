# Restart All Services
# Run from project root: powershell -File scripts/restart-all.ps1

# Determine project root
if ($MyInvocation.MyCommand.Path) {
    $projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
} elseif ($PSScriptRoot) {
    $projectRoot = Split-Path -Parent $PSScriptRoot
} else {
    $projectRoot = Get-Location
}

Write-Host "Restarting all services..." -ForegroundColor Cyan

# Stop all services
& "$projectRoot\scripts\stop-all.ps1"

# Wait a moment for ports to be released
Start-Sleep -Seconds 2

# Start all services
& "$projectRoot\scripts\start-all.ps1"
