@echo off
rem SLIDE STUDIO NEO launcher. Messages are printed by scripts\launcher.mjs.
rem   (no argument) visible window: prepare if needed, then serve. Closing the window stops it.
rem   prepare       install/build only when needed (start-neo.vbs shows this window only then)
rem   serve         start the server and open the browser (start-neo.vbs runs this hidden)
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title SLIDE STUDIO NEO
if "%NEO_PORT%"=="" set NEO_PORT=3000

if /i "%~1"=="serve" goto serve

if /i not "%~1"=="prepare" (
  rem Already running: just open the browser
  node scripts\launcher.mjs running
  if not errorlevel 1 (
    node scripts\launcher.mjs open
    exit /b 0
  )
)

if not exist node_modules (
  node scripts\launcher.mjs say install
  call npm install || goto failed
)

rem Build only when missing or older than the sources
node scripts\launcher.mjs needs-build
if %errorlevel%==1 (
  node scripts\launcher.mjs say build
  call npm run build || goto failed
)
if /i "%~1"=="prepare" exit /b 0

node scripts\launcher.mjs say starting
start "" /b node scripts\launcher.mjs open
call npx next start --hostname 127.0.0.1 --port %NEO_PORT%
exit /b 0

:serve
rem Hidden: no one sees the output, so keep the last run's log for troubleshooting
start "" /b node scripts\launcher.mjs open
call npx next start --hostname 127.0.0.1 --port %NEO_PORT% > ".next\neo-server.log" 2>&1
exit /b 0

:failed
node scripts\launcher.mjs say failed
pause
exit /b 1
