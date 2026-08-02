@echo off
title KSB Pump Selector
cd /d "%~dp0"
cls
echo.
echo   ===========================================
echo      KSB Pump Selector
echo   ===========================================
echo.

REM ---- Is the app already running? Just open the browser again. ----
powershell -NoProfile -Command "try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',3000);$c.Close();exit 0}catch{exit 1}" >nul 2>nul
if not errorlevel 1 goto :alreadyrunning

REM ---- Is Node.js installed? ----
where node >nul 2>nul
if errorlevel 1 goto :nonode

REM ---- Is the pump/price database present? ----
if not exist "data\ksb.sqlite" goto :nodatabase

REM ---- Are the installed files usable on THIS computer? ----
REM (node_modules copied from another computer contains programs built for
REM  that machine and will not run here. Detect it and rebuild quietly.)
if not exist "node_modules" goto :install
node -e "const D=require('better-sqlite3'); new D(':memory:').close()" >nul 2>nul
if errorlevel 1 goto :wrongmachine
goto :checkbuild

:wrongmachine
echo   These files were prepared on a different computer.
echo   Setting them up for this one - please wait.
echo.
rmdir /s /q "node_modules" >nul 2>nul
rmdir /s /q ".next" >nul 2>nul

:install
echo   First-time setup.
echo   This needs the internet and takes a few minutes.
echo   Please leave this window open.
echo.
call npm install
if errorlevel 1 goto :installfailed

:checkbuild
if exist ".next\BUILD_ID" goto :run
echo   Preparing the app - one-time step, please wait.
echo.
call npm run build
if errorlevel 1 goto :buildfailed

:run
REM ---- Put a shortcut on the Desktop so this is one click next time ----
powershell -NoProfile -Command "$d=[Environment]::GetFolderPath('Desktop'); $p=Join-Path $d 'KSB Pump Selector.lnk'; $w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut($p); $s.TargetPath='%~f0'; $s.WorkingDirectory='%~dp0'; $s.Description='KSB Agricultural Pump Selector'; $s.Save()" >nul 2>nul

REM ---- Open the browser only once the app is actually ready ----
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 600;$i++){try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',3000);$c.Close();Start-Process 'http://localhost:3000';break}catch{Start-Sleep -Milliseconds 500}}"

cls
echo.
echo   ===========================================
echo      KSB Pump Selector is starting
echo   ===========================================
echo.
echo   Your browser will open by itself in a moment.
echo.
echo   If it does not, open your browser and go to:
echo       http://localhost:3000
echo.
echo   -------------------------------------------
echo   KEEP THIS WINDOW OPEN while you use the app.
echo   Close it when you are finished.
echo   -------------------------------------------
echo.
call npm start
goto :stopped

:alreadyrunning
echo   The app is already running.
echo   Opening it in your browser...
echo.
start "" http://localhost:3000
timeout /t 3 >nul
goto :eof

:nonode
echo   Node.js needs to be installed first ^(one time only^).
echo.
echo     1. Go to:  https://nodejs.org
echo     2. Click the big green "LTS" button.
echo     3. Run the downloaded file, clicking Next / OK
echo        until it finishes.
echo     4. Double-click this KSB icon again.
echo.
echo   Press any key to open the download page...
pause >nul
start "" https://nodejs.org
goto :eof

:nodatabase
echo   The pump and price database is missing.
echo.
echo   The file  data\ksb.sqlite  is not in this folder.
echo   The folder was probably copied without it.
echo.
echo   Ask Satya to send the complete folder again.
echo.
pause
goto :eof

:installfailed
echo.
echo   Setup could not finish.
echo.
echo   The most likely reason is no internet connection.
echo   Connect to the internet and double-click the KSB
echo   icon again.
echo.
pause
goto :eof

:buildfailed
echo.
echo   The app could not be prepared.
echo.
echo   Please send this window's text to Satya.
echo.
pause
goto :eof

:stopped
echo.
echo   The app has stopped. You can close this window.
echo.
pause
