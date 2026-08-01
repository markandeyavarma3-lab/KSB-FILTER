@echo off
title KSB Pump Selector
cd /d "%~dp0"

if not exist node_modules (
    echo ============================================
    echo First-time setup. This installs the app and
    echo can take a few minutes. Please wait...
    echo ============================================
    call npm install
    if errorlevel 1 goto :error
)

if not exist ".next" (
    echo Building the app - one-time step, please wait...
    call npm run build
    if errorlevel 1 goto :error
)

echo.
echo Starting KSB Pump Selector...
echo Your browser will open automatically. To stop the
echo app, just close this window.
echo.
start "" http://localhost:3000
call npm start
goto :eof

:error
echo.
echo ============================================
echo Setup failed.
echo Make sure Node.js is installed first:
echo   https://nodejs.org  (click the LTS button)
echo Then double-click this file again.
echo ============================================
pause
