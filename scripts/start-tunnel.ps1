Write-Host "Starting Cloudflare Tunnel (api-rag.jungholee.com -> localhost:8000)..." -ForegroundColor Cyan
Write-Host "Make sure the backend is running on http://localhost:8000 first." -ForegroundColor Yellow
Write-Host ""

$cloudflared = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe"

if (-Not (Test-Path $cloudflared)) {
    Write-Host "cloudflared not found at expected path. Trying PATH..." -ForegroundColor Yellow
    $cloudflared = "cloudflared"
}

& $cloudflared tunnel run rag-backend
