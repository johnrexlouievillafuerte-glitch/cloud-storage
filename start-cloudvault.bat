@echo off
echo ========================================
echo   CloudVault - Startup Script
echo ========================================
echo.

:: Start MySQL if not running
echo [1/3] Starting MySQL...
net start MySQL80 2>nul
if %errorlevel% neq 0 (
    echo       MySQL is already running.
) else (
    echo       MySQL started successfully.
)

:: Start Apache
echo [2/3] Starting Apache...
tasklist /FI "IMAGENAME eq httpd.exe" | find "httpd.exe" >nul
if %errorlevel% equ 0 (
    echo       Apache is already running.
) else (
    start "" "C:\xampp\apache\bin\httpd.exe"
    echo       Apache started successfully.
)

:: Start Node.js backend with pm2
echo [3/3] Starting CloudVault API...
call npx pm2 resurrect 2>nul
call npx pm2 start "C:\Users\Johnrex Louie\projects\cloud-storage\server\index.js" --name cloudvault-api --update-env 2>nul
call npx pm2 save

echo.
echo ========================================
echo   CloudVault is running!
echo   Local:  http://localhost/cloudvault/
echo ========================================
echo.
pause
