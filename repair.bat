@echo off
rem FriendsInVoice repair for Windows: double-click this file. The work is done by repair.mjs.
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js isn't installed. Run install.bat first, or install Node.js 22+ from https://nodejs.org and run this again.
    pause
    exit /b 1
)
node "%~dp0repair.mjs" %*
pause
