# Supabase Keep-Alive Script
# Prevents free-tier Supabase project from pausing due to inactivity.
# Run this as a scheduled task (Windows Task Scheduler) every 3 days.
#
# Setup:
#   1. Open Task Scheduler (taskschd.msc)
#   2. Create Basic Task > "Supabase Keep Alive"
#   3. Trigger: Daily, repeat every 3 days
#   4. Action: Start a program
#      Program: powershell
#      Arguments: -File "C:\Users\Jungho\Desktop\Workspace\rag\scripts\keep-alive.ps1"
#   5. Check "Run whether user is logged on or not"

$supabaseUrl = "https://dkbbhbpluvtimzzyavyg.supabase.co"

Write-Host "[$(Get-Date)] Supabase keep-alive ping..." -ForegroundColor Cyan

try {
    # Ping the REST API (lightweight, no auth needed for health)
    $response = Invoke-WebRequest -Uri "$supabaseUrl/rest/v1/" -Method Head -UseBasicParsing -TimeoutSec 10
    Write-Host "[$(Get-Date)] Supabase responded: $($response.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "[$(Get-Date)] Supabase ping failed: $($_.Exception.Message)" -ForegroundColor Yellow

    # Fallback: try the auth endpoint
    try {
        $response = Invoke-WebRequest -Uri "$supabaseUrl/auth/v1/health" -Method Get -UseBasicParsing -TimeoutSec 10
        Write-Host "[$(Get-Date)] Auth health responded: $($response.StatusCode)" -ForegroundColor Green
    } catch {
        Write-Host "[$(Get-Date)] All pings failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}
