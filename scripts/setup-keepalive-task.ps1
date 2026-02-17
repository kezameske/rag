# Sets up a Windows Task Scheduler task to ping Supabase every 3 days
# Run once: powershell -File scripts/setup-keepalive-task.ps1

$taskName = "SupabaseKeepAlive"
$scriptPath = Join-Path $PSScriptRoot "keep-alive.ps1"

# Remove existing task if any
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Create trigger: every 3 days at 10 AM
$trigger = New-ScheduledTaskTrigger -Daily -DaysInterval 3 -At "10:00AM"

# Create action
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""

# Create settings
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# Register the task
Register-ScheduledTask -TaskName $taskName -Trigger $trigger -Action $action -Settings $settings -Description "Pings Supabase to prevent free-tier inactivity pause"

Write-Host "Scheduled task '$taskName' created successfully!" -ForegroundColor Green
Write-Host "Supabase will be pinged every 3 days at 10:00 AM." -ForegroundColor Cyan
Write-Host ""
Write-Host "To verify: Get-ScheduledTask -TaskName '$taskName'" -ForegroundColor Gray
Write-Host "To remove: Unregister-ScheduledTask -TaskName '$taskName'" -ForegroundColor Gray
