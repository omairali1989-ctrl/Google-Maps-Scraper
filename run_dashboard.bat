@echo off
echo =========================================
echo    Launching Extractrix Maps Scraper
echo =========================================

:: 1. Activate venv
if exist venv (
    call venv\Scripts\activate
) else (
    echo Virtual environment not found! Running setup first...
    call setup.bat
    call venv\Scripts\activate
)

:: 2. Check and Install Node modules if missing
if exist frontend (
    if not exist frontend\node_modules (
        echo Installing missing frontend node packages...
        cd frontend
        call npm install
        cd ..
    )
)

:: 3. Start Flask server in background
echo Starting backend scraper on http://localhost:5001...
start /B python app/web_server.py

:: 4. Start Next.js frontend in background
echo Starting Next.js dashboard on http://localhost:3000...
cd frontend
start /B npm run dev
cd ..

:: 5. Wait a few seconds for initialization
timeout /t 3 /nobreak >nul

:: 6. Open default browser
echo Opening browser dashboard...
start http://localhost:3000

:: 7. Keep command prompt open
echo.
echo Extractrix Scraper and Dashboard are now active.
echo Press Ctrl+C in this window to exit and stop all servers.
echo.
pause
