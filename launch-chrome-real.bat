@echo off
echo ==========================================
echo Launching Chrome with Remote Debugging
echo ==========================================
echo.
echo This will launch Chrome with:
echo   - Remote debugging on port 9222
echo   - Proxy configured (localhost:8001)
echo   - User data directory in temp folder
echo.
echo IMPORTANT: Make sure proxy server is running first!
echo   Run: npm run test:proxy (in another terminal)
echo.

set DEBUG_PORT=9222
set USER_DATA_DIR=%TEMP%\chrome-debug
set PROXY=localhost:8001

REM Find Chrome executable
set CHROME_PATH=
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set CHROME_PATH="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
) else if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    set CHROME_PATH="%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
) else (
    echo ERROR: Chrome not found!
    echo Please install Google Chrome or update the path in this script.
    pause
    exit /b 1
)

echo Chrome found at: %CHROME_PATH%
echo.
echo Launching Chrome...
echo.

REM Launch Chrome with remote debugging and proxy
start "" %CHROME_PATH% --remote-debugging-port=%DEBUG_PORT% --user-data-dir=%USER_DATA_DIR% --proxy-server=http://%PROXY%

echo.
echo Chrome launched!
echo.
echo Now run the bot with:
echo   set USE_REAL_BROWSER=true
echo   npm run dev_exec:dev
echo.
pause

