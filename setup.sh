#!/bin/bash
# Exit on error
set -e

echo "========================================="
echo "   Extractrix Google Maps Scraper Setup"
echo "========================================="

# 1. Check Python
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is not installed!"
    echo "Please download and install Python 3 from https://www.python.org/downloads/"
    exit 1
fi

# 2. Create Virtual Environment
if [ ! -d "venv" ]; then
    echo "Creating virtual environment (venv)..."
    python3 -m venv venv
fi

# 3. Activate Virtual Environment & Install Dependencies
echo "Activating virtual environment..."
source venv/bin/activate

echo "Upgrading pip..."
pip install --upgrade pip

echo "Installing required Python packages..."
# Install standard dependencies
pip install -r requirements_utf8.txt

# 4. Patch undetected_chromedriver on macOS to support Gatekeeper bypass
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "Applying macOS codesigning patch to undetected_chromedriver..."
    # Find patcher.py in the newly created venv
    PATCHER_PATH=$(find venv -name "patcher.py")
    if [ -f "$PATCHER_PATH" ]; then
        # Check if codesign command is already added
        if ! grep -q "codesign" "$PATCHER_PATH"; then
            # Insert the codesign call into patcher.py
            python3 -c "
path = '$PATCHER_PATH'
with open(path, 'r') as f:
    code = f.read()

target = 'fh.write(new_content)'
patch = '''fh.write(new_content)
        if sys.platform.startswith(\"darwin\"):
            import subprocess
            try:
                res = subprocess.run([\"/usr/bin/codesign\", \"--force\", \"--deep\", \"--sign\", \"-\", self.executable_path], capture_output=True, text=True)
                if res.returncode != 0:
                    logger.warning(\"codesign failed: %s %s\" % (res.stdout, res.stderr))
            except Exception as e:
                logger.warning(\"Could not codesign patched binary: %s\" % e)'''

if target in code:
    code = code.replace(target, patch)
    with open(path, 'w') as f:
        f.write(code)
    print('Successfully patched undetected_chromedriver!')
else:
    print('Target hook not found in patcher.py.')
"
        fi
    fi
fi

# 5. Create relative output folder
mkdir -p output

# 6. Install Node.js frontend dependencies
echo "Installing Node.js dependencies in frontend..."
if ! command -v npm &> /dev/null; then
    echo "Warning: Node.js (npm) is not installed!"
    echo "Please download and install Node.js (version 18+) from https://nodejs.org/"
    echo "You will need it to run the Next.js frontend."
else
    cd frontend
    npm install
    cd ..
fi

echo "========================================="
echo "Setup complete!"
echo "To launch the web dashboard, run: ./run_dashboard.sh"
echo "========================================="
