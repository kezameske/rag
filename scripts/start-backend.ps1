# Start Backend Server
# Run from project root: powershell -File scripts/start-backend.ps1

try {
    # Determine project root - handle both direct execution and Start-Process
    if ($MyInvocation.MyCommand.Path) {
        $projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
    } elseif ($PSScriptRoot) {
        $projectRoot = Split-Path -Parent $PSScriptRoot
    } else {
        $projectRoot = Get-Location
    }

    Write-Host "Starting backend server..." -ForegroundColor Green
    Write-Host "Project root: $projectRoot" -ForegroundColor Gray
    
    Set-Location "$projectRoot\backend"

    # Activate virtual environment and start uvicorn
    & .\venv\Scripts\Activate.ps1
    python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Press any key to exit..." -ForegroundColor Yellow
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
