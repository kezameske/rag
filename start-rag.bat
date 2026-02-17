@echo off
title RAG Service Launcher

echo ========================================
echo   Starting RAG Services
echo ========================================
echo.

:: Get the directory where this batch file lives
set "PROJECT_ROOT=%~dp0"

:: Start backend in a new window
echo Starting backend (http://localhost:8000)...
start "RAG Backend" cmd /k "cd /d %PROJECT_ROOT%backend && call venv\Scripts\activate.bat && python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

:: Brief pause to stagger startup
timeout /t 2 /nobreak >nul

:: Start frontend in a new window
echo Starting frontend (http://localhost:5173)...
start "RAG Frontend" cmd /k "cd /d %PROJECT_ROOT%frontend && npm run dev"

:: Brief pause before tunnel
timeout /t 2 /nobreak >nul

:: Start Cloudflare Tunnel in a new window
echo Starting Cloudflare Tunnel (api-rag.jungholee.com)...
start "RAG Tunnel" /min cmd /k ""%LOCALAPPDATA%\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe" tunnel run rag-backend"

echo.
echo ========================================
echo   Services starting in new windows:
echo     Backend:  http://localhost:8000
echo     Frontend: http://localhost:5173
echo     Tunnel:   https://api-rag.jungholee.com
echo ========================================
echo.
echo Close this window anytime. The services
echo will keep running in their own windows.
echo (Tunnel window starts minimized)
echo.
pause
