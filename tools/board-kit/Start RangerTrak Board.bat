@echo off
REM RangerTrak Board kit - double-click launcher (Windows). E-255.
REM
REM The kit's own launcher, built into rangertrak-board-<version>.zip by tools\board-kit\build.js.
REM Unlike "Start Command Post Server.bat" at the repo root, nothing here needs npm or a build:
REM rangertrak-board.js carries the Board and its packages, and app\ the built app. Node.js 24 is
REM the one thing to install.
REM
REM %~dp0 is this file's own folder, with a trailing backslash; a double-click does not
REM guarantee the starting folder.
cd /d "%~dp0"
title RangerTrak Board

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo The RangerTrak Board needs Node.js, and this computer doesn't have it
  echo ^(or it isn't on the PATH^).
  echo.
  echo Install the LTS version from https://nodejs.org ^(it needs the Internet, so do it
  echo before you leave for the field^), then double-click this file again.
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
  echo This computer's Node.js is too old ^(found %NODEVER%, need 24 or newer^).
  echo Install the LTS version from https://nodejs.org, then double-click this file again.
  echo.
  pause
  exit /b 1
)

if not exist "app\index.html" (
  echo.
  echo The app folder is missing from this kit. Unzip the whole kit into one folder
  echo ^(don't run this file from inside the zip^), then double-click it again.
  echo.
  pause
  exit /b 1
)

node rangertrak-board.js %*

echo.
echo The Board stopped. Close this window, or double-click this file again to restart it.
pause
