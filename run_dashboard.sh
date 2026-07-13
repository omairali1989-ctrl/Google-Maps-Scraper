#!/bin/bash
echo "========================================="
echo "   Launching Extractrix Maps Scraper"
echo "========================================="

# 1. Activate venv
if [ -d "venv" ]; then
    source venv/bin/activate
else
    echo "Virtual environment not found! Running setup first..."
    chmod +x setup.sh
    ./setup.sh
    source venv/bin/activate
fi

# 2. Check and Install Node modules if missing
if [ -d "frontend" ]; then
    if [ ! -d "frontend/node_modules" ]; then
        echo "Installing missing frontend node packages..."
        cd frontend && npm install && cd ..
    fi
fi

# 3. Start FastAPI server in background
echo "Starting backend scraper on http://localhost:5001..."
python3 app/main.py &
BACKEND_PID=$!

# 4. Start Next.js frontend in background
echo "Starting Next.js dashboard on http://localhost:3000..."
cd frontend && npm run dev &
FRONTEND_PID=$!
cd ..

# Clean up server on exit
cleanup() {
    echo "Shutting down servers..."
    kill $BACKEND_PID
    kill $FRONTEND_PID
    exit 0
}
trap cleanup SIGINT SIGTERM

# 5. Wait a few seconds for servers to initialize
sleep 3

# 6. Open default browser
echo "Opening browser dashboard..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    open "http://localhost:3000"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    xdg-open "http://localhost:3000"
else
    echo "Please open http://localhost:3000 in your browser."
fi

# 7. Wait for processes to end
wait $BACKEND_PID
wait $FRONTEND_PID
