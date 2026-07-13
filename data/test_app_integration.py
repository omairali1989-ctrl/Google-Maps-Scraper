import sqlite3
import urllib.request
import json
import os
import sys

def check_database():
    print("📋 Checking SQLite Database...")
    db_path = "data/extractrx.db"
    if not os.path.exists(db_path):
        print(f"❌ Database file not found at: {db_path}")
        sys.exit(1)
        
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    
    # Check tables
    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [t[0] for t in cur.fetchall()]
    
    required_tables = ["records", "scrape_jobs", "saved_filters", "export_history"]
    for t in required_tables:
        if t in tables:
            print(f"  ✓ Table '{t}' exists")
        else:
            print(f"  ❌ Missing table '{t}'")
            sys.exit(1)
            
    # Check records count
    cur.execute("SELECT COUNT(*) FROM records")
    count = cur.fetchone()[0]
    print(f"  ✓ Records count in database: {count}")
    
    conn.close()

def check_endpoint(url, name):
    print(f"📋 Checking endpoint {name} ({url})...")
    try:
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status == 200:
                print(f"  ✓ {name} is online (200 OK)")
                return True
            else:
                print(f"  ❌ {name} returned status: {response.status}")
                return False
    except Exception as e:
        print(f"  ❌ Failed to reach {name}: {e}")
        return False

def check_json_endpoint(url, name, check_success=True):
    print(f"📋 Checking API response for {name} ({url})...")
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            data = json.loads(response.read().decode())
            if response.status == 200:
                # Success condition: either check_success is False, or it has 'success': True, or it has 'is_running' (old format), 
                # or it returns a dict where values have 'is_running' (new job dict format), or it's empty {}
                is_valid_jobs_dict = isinstance(data, dict) and all(isinstance(v, dict) and "is_running" in v for v in data.values())
                if not check_success or data.get("success") is True or "is_running" in data or is_valid_jobs_dict or data == {}:
                    print(f"  ✓ {name} API returned success (HTTP 200)")
                    return True
                else:
                    print(f"  ❌ {name} API returned: {data}")
                    return False
            else:
                print(f"  ❌ {name} returned HTTP {response.status}")
                return False
    except Exception as e:
        print(f"  ❌ Failed to fetch {name} API: {e}")
        return False

if __name__ == "__main__":
    print("🚀 Running Extractrix Application Integration Tests...")
    print("=" * 50)
    
    check_database()
    print("-" * 50)
    
    # Test Next.js Frontend pages (via local dev server)
    frontend_ok = True
    frontend_ok &= check_endpoint("http://localhost:3000/dashboard", "Next.js Dashboard Page")
    frontend_ok &= check_endpoint("http://localhost:3000/explorer", "Next.js Data Explorer Page")
    frontend_ok &= check_endpoint("http://localhost:3000/exports", "Next.js Export Wizard Page")
    frontend_ok &= check_endpoint("http://localhost:3000/map", "Next.js Map View Page")
    frontend_ok &= check_endpoint("http://localhost:3000/scraper", "Next.js Scraper Page")
    frontend_ok &= check_endpoint("http://localhost:3000/settings", "Next.js Settings Page")
    print("-" * 50)
    
    # Test Next.js API endpoints
    api_ok = True
    api_ok &= check_json_endpoint("http://localhost:3000/api/v2/records?limit=1", "Records list API")
    api_ok &= check_json_endpoint("http://localhost:3000/api/v2/filters/options", "Filter Options API")
    api_ok &= check_json_endpoint("http://localhost:3000/api/v2/exports", "Exports history API")
    print("-" * 50)
    
    # Test Flask Python backend status
    backend_ok = check_json_endpoint("http://localhost:5001/api/status", "Flask Backend Status API")
    print("=" * 50)
    
    if frontend_ok and api_ok and backend_ok:
        print("🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!")
        sys.exit(0)
    else:
        print("❌ SOME INTEGRATION TESTS FAILED. Please check logs.")
        sys.exit(1)
