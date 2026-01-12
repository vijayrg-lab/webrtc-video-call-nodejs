@echo off
REM HTTPS Setup Script for WebRTC Mobile Testing (Windows)
REM This script helps set up HTTPS certificates using mkcert

echo ==========================================
echo WebRTC HTTPS Setup Script
echo ==========================================
echo.

REM Check if mkcert is installed
where mkcert >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] mkcert is not installed.
    echo.
    echo Install mkcert:
    echo   choco install mkcert
    echo   OR download from: https://github.com/FiloSottile/mkcert/releases
    echo.
    pause
    exit /b 1
)

echo [OK] mkcert found
echo.

REM Get local IP address
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set LOCAL_IP=%%a
    set LOCAL_IP=!LOCAL_IP:~1!
    goto :found
)
:found

if "%LOCAL_IP%"=="" set LOCAL_IP=192.168.1.8

echo Detected local IP: %LOCAL_IP%
set /p confirm="Use this IP? (y/n) [y]: "
if "%confirm%"=="" set confirm=y

if /i not "%confirm%"=="y" (
    set /p LOCAL_IP="Enter your local IP address: "
)

echo.
echo Setting up certificates for:
echo   - %LOCAL_IP%
echo   - localhost
echo   - 127.0.0.1
echo.

REM Create certs directory
if not exist certs mkdir certs

REM Generate certificates
echo Generating certificates...
mkcert -cert-file certs\cert.pem -key-file certs\key.pem %LOCAL_IP% localhost 127.0.0.1 ::1

echo.
echo ==========================================
echo [OK] Certificates generated successfully!
echo ==========================================
echo.
echo Certificates saved to:
echo   - certs\cert.pem
echo   - certs\key.pem
echo.
echo Next steps:
echo 1. Set USE_HTTPS=true environment variable:
echo    set USE_HTTPS=true
echo.
echo 2. Start the server:
echo    npm start
echo.
echo 3. Access from mobile:
echo    https://%LOCAL_IP%:3004
echo.
echo 4. Install CA on mobile device:
echo    Find rootCA.pem in: %USERPROFILE%\AppData\Local\mkcert
echo    Transfer this file to your mobile device and install it
echo.
pause
