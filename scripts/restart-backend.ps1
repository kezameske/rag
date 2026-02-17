# Restart Backend Server
# Run from project root: powershell -File scripts/restart-backend.ps1

# Determine project root
if ($MyInvocation.MyCommand.Path) {
    $projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
} elseif ($PSScriptRoot) {
    $projectRoot = Split-Path -Parent $PSScriptRoot
} else {
    $projectRoot = Get-Location
}

Write-Host "Restarting backend server..." -ForegroundColor Cyan

# Stop backend
& "$projectRoot\scripts\stop-backend.ps1"

# Wait a moment for port to be released
Start-Sleep -Seconds 2

# Start backend in new window
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$projectRoot'; & '.\scripts\start-backend.ps1'"

Write-Host "`nBackend restarting in new window: http://localhost:8000" -ForegroundColor Green
