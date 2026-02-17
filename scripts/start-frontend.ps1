# Start Frontend Server
# Run from project root: powershell -File scripts/start-frontend.ps1

try {
    # Determine project root - handle both direct execution and Start-Process
    if ($MyInvocation.MyCommand.Path) {
        $projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
    } elseif ($PSScriptRoot) {
        $projectRoot = Split-Path -Parent $PSScriptRoot
    } else {
        $projectRoot = Get-Location
    }

    Write-Host "Starting frontend server..." -ForegroundColor Green
    Write-Host "Project root: $projectRoot" -ForegroundColor Gray
    
    Set-Location "$projectRoot\frontend"

    npm run dev
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Press any key to exit..." -ForegroundColor Yellow
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
