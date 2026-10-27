@echo off
title MitochronAi Lab (lab network)
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
rem Listen on the lab network as well as this PC, so phones and other computers on the same Wi-Fi can open it.
set MCL_HOST=0.0.0.0
set MCL_PORT=3000
set IP=
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1).IPAddress"`) do set IP=%%i
echo.
echo  MitochronAi Lab is starting for the whole lab network.
echo    On this PC:                  http://127.0.0.1:%MCL_PORT%
if defined IP echo    On phones and other PCs:     http://%IP%:%MCL_PORT%   (same Wi-Fi only)
echo  Keep this window open; close it to stop.
echo.
start "" cmd /c "timeout /t 8 >nul & start http://127.0.0.1:%MCL_PORT%"
node scripts\run.mjs
pause
