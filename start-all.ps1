Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "    WARDEN SECURITY MONITORING PLATFORM BOOTSTRAP       " -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

# Check if Docker container is running
$dockerCheck = docker ps --filter "name=warden_postgres" --format "{{.Names}}"
if ([string]::IsNullOrEmpty($dockerCheck)) {
    Write-Host "[WARNING] warden_postgres container is not running!" -ForegroundColor Yellow
    Write-Host "Starting PostgreSQL container via Docker Compose..." -ForegroundColor Yellow
    docker compose up -d
    Start-Sleep -Seconds 5
} else {
    Write-Host "[OK] PostgreSQL container (warden_postgres) is running." -ForegroundColor Green
}

# Start Client Backend (Port 4001)
Write-Host "[1/4] Launching Client Portal Backend on Port 4001..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "\$host.ui.RawUI.WindowTitle = 'Warden Client Backend'; cd client-portal/backend; npm start"

# Start Client Frontend (Port 3001)
Write-Host "[2/4] Launching Client Portal Frontend on Port 3001..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "\$host.ui.RawUI.WindowTitle = 'Warden Client Frontend'; cd client-portal/frontend; npm run dev"

# Start Central Backend (Port 5000)
Write-Host "[3/4] Launching Central Platform Backend on Port 5000..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "\$host.ui.RawUI.WindowTitle = 'Warden Central Backend'; cd central-portal/backend; npm start"

# Start Central Frontend (Port 3002)
Write-Host "[4/4] Launching Central Platform Frontend on Port 3002..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "\$host.ui.RawUI.WindowTitle = 'Warden Central Frontend'; cd central-portal/frontend; npm run dev"

Write-Host "--------------------------------------------------------" -ForegroundColor Cyan
Write-Host "Boot completed! Portal urls:" -ForegroundColor Yellow
Write-Host " - Client Portal (Acme):  http://localhost:3001" -ForegroundColor Green
Write-Host " - Central Monitoring:    http://localhost:3002" -ForegroundColor Green
Write-Host " - Central API Endpoint:  http://localhost:5000" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "Leave the opened consoles running to preserve execution logs." -ForegroundColor White
