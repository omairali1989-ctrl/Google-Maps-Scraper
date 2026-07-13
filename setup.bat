@echo off
echo =========================================
echo    Extractrix Google Maps Scraper Setup
echo =========================================

:: 1. Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Python is not installed or not in your PATH!
    echo Please install Python 3 from https://www.python.org/downloads/
    echo Make sure to check the box "Add Python to PATH" during installation.
    pause
    exit /b 1
)

:: 2. Create Virtual Environment
if not exist venv (
    echo Creating virtual environment (venv)...
    python -m venv venv
)

:: 3. Activate Virtual Environment & Install Dependencies
echo Activating virtual environment...
call venv\Scripts\activate

echo Upgrading pip...
python -m pip install --upgrade pip

echo Installing required Python packages...
pip install -r requirements_utf8.txt

:: 4. Create relative output folder
if not exist output (
    mkdir output
)

:: 5. Install Node.js dependencies in frontend
echo Installing Node.js dependencies in frontend...
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo Warning: Node.js (npm) is not installed!
    echo Please download and install Node.js (version 18+) from https://nodejs.org/
    echo You will need it to run the Next.js frontend.
) else (
    cd frontend
    call npm install
    cd ..
)

echo =========================================
echo Setup complete!
echo To launch the web dashboard, run: run_dashboard.bat
echo =========================================
pause
