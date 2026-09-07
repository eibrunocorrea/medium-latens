@echo off
rem Medium Latens - loop do servidor (equivalente Windows do launchd KeepAlive)
set MEDIUM_LATENS_SERVICE=1
set LOGDIR=%APPDATA%\Medium Latens\logs
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
:loop
node "%~dp0..\server.js" >> "%LOGDIR%\out.log" 2>> "%LOGDIR%\err.log"
timeout /t 3 /nobreak >nul
goto loop
