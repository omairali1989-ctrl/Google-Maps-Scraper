import os

OUTPUT_PATH = "output/"

# Resolve driver path relative to the workspace root
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRIVER_EXECUTABLE_PATH = os.path.join(BASE_DIR, "drivers", "chromedriver")
DB_PATH = os.path.join(BASE_DIR, "data", "extractrx.db")

# Use the chromium-driver installed from apt-get if running in Docker
if os.environ.get("IS_DOCKER") == "true":
    DRIVER_EXECUTABLE_PATH = '/usr/bin/chromedriver'
