@echo off
rem SLIDE STUDIO NEO launcher (double-click). Messages are printed by scripts\launcher.mjs.
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title SLIDE STUDIO NEO
if "%NEO_PORT%"=="" set NEO_PORT=3000

rem Already running: just open the browser
node scripts\launcher.mjs running
if %errorlevel%==0 (
  node scripts\launcher.mjs open
  exit /b 0
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

node scripts\launcher.mjs say starting
start "" /b node scripts\launcher.mjs open
call npx next start --hostname 127.0.0.1 --port %NEO_PORT%
exit /b 0

:failed
node scripts\launcher.mjs say failed
pause
exit /b 1
