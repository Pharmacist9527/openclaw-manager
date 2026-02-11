@echo off
echo.
echo  OpenClaw Quick Setup
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed.
    echo Please install Node.js 22+ from https://nodejs.org
    pause
    exit /b 1
)

cd /d "%~dp0"

if not exist node_modules (
    echo Installing dependencies...
    call npm install --silent
)

node bin/setup.js
pause
