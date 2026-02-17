# Restart Frontend Server
# Run from project root: powershell -File scripts/restart-frontend.ps1

# Determine project root
if ($MyInvocation.MyCommand.Path) {
    $projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
} elseif ($PSScriptRoot) {
    $projectRoot = Split-Path -Parent $PSScriptRoot
} else {
    $projectRoot = Get-Location
}

Write-Host "Restarting frontend server..." -ForegroundColor Cyan

# Stop frontend
& "$projectRoot\scripts\stop-frontend.ps1"

# Wait a moment for port to be released
Start-Sleep -Seconds 2

# Start frontend in new window
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$projectRoot'; & '.\scripts\start-frontend.ps1'"

Write-Host "`nFrontend restarting in new window: http://localhost:5173" -ForegroundColor Green
