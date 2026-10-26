@echo off
title MitochronAi Lab
cd /d "%~dp0web"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js isn't installed on this PC. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Installing the app's components (first time only, needs internet)...
  call npm ci || (echo Install failed. & pause & exit /b 1)
)
echo Starting MitochronAi Lab at http://127.0.0.1:3000  (this PC only). Keep this window open; close it to stop.
start "" cmd /c "timeout /t 8 >nul & start http://127.0.0.1:3000"
node scripts\run.mjs
pause
