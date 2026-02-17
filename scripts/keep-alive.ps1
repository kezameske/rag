Write-Host "Supabase Keep-Alive started. Pings every 6 hours." -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host ""

$url = "http://localhost:8000/health"
$interval = 6 * 60 * 60  # 6 hours in seconds

while ($true) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    try {
        $response = Invoke-RestMethod -Uri $url -TimeoutSec 10
        Write-Host "[$timestamp] Ping OK - $($response.status)" -ForegroundColor Green
    } catch {
        Write-Host "[$timestamp] Ping failed - $($_.Exception.Message)" -ForegroundColor Red
    }
    Start-Sleep -Seconds $interval
}
