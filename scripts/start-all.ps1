# Start All Services
# Run from project root: powershell -File scripts/start-all.ps1
# This opens two new terminal windows for backend and frontend

# Determine project root
if ($MyInvocation.MyCommand.Path) {
    $projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
} elseif ($PSScriptRoot) {
    $projectRoot = Split-Path -Parent $PSScriptRoot
} else {
    $projectRoot = Get-Location
}

Write-Host "Starting all services..." -ForegroundColor Green
Write-Host "Project root: $projectRoot" -ForegroundColor Gray

# Start backend in new window - use -Command instead of -File for better error handling
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$projectRoot'; & '.\scripts\start-backend.ps1'"

# Brief pause to stagger startup
Start-Sleep -Milliseconds 500

# Start frontend in new window
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$projectRoot'; & '.\scripts\start-frontend.ps1'"

Write-Host "Services starting in separate windows:" -ForegroundColor Cyan
Write-Host "  Backend:  http://localhost:8000" -ForegroundColor Yellow
Write-Host "  Frontend: http://localhost:5173" -ForegroundColor Yellow
