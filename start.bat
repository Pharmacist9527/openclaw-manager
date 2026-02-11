@echo off
echo Starting OpenClaw Gateway...

where openclaw >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: OpenClaw is not installed. Please run setup.bat first.
    pause
    exit /b 1
)

openclaw gateway start --port 28789
pause
