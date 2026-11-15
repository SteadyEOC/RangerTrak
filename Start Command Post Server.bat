@echo off
REM RangerView - double-click launcher (Windows).
REM
REM Raised live 2026-08-31: "anything to simplify creation or admin?" - before this, starting
REM the server meant knowing what a terminal is, what npm is, and typing a command correctly.
REM This exists so a non-technical coordinator can just double-click a file instead. It does
REM NOT replace `npm run command-post` for anyone comfortable with a terminal - both run the
REM exact same tools\command-post-server.js.
REM
REM E-216: checks Node.js (present, version 24 or newer), npm ci, and the build before running.
REM
REM %~dp0 is this .bat file's own folder, with a trailing backslash - used instead of assuming
REM the double-click starts in any particular folder, which Windows does not guarantee.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo This computer doesn't have Node.js ^(or it isn't on the PATH^).
  echo Install the current LTS from https://nodejs.org, then run this again.
  echo.
  pause
  exit /b 1
)

REM NODE_VERSION_OVERRIDE is for testing the check only; leave it unset.
set "NODEVER=%NODE_VERSION_OVERRIDE%"
if not defined NODEVER for /f "delims=" %%v in ('node --version') do set "NODEVER=%%v"
set "NODEMAJOR="
for /f "tokens=1 delims=." %%a in ("%NODEVER:v=%") do set "NODEMAJOR=%%a"
set /a NODEMAJOR_N=0
set /a NODEMAJOR_N=%NODEMAJOR% 2>nul
if %NODEMAJOR_N% LSS 24 (
  echo.
  echo This computer's Node.js is too old ^(found %NODEVER%, need 24 or newer^). Install the current LTS from https://nodejs.org, then run this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo Run this once first: npm ci
  echo.
  pause
  exit /b 1
)

if not exist "dist\rangertrak\browser\index.html" (
  echo.
  echo RangerTrak isn't built yet. Run: npx ng build
  echo.
  pause
  exit /b 1
)

node tools\command-post-server.js

echo.
echo The RangerView mini web server stopped. Close this window, or double-click this file again to restart it.
pause
