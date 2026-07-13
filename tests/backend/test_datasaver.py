import pytest
import os
import sys
import tempfile
import sqlite3
import pandas as pd
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../app')))

from app.scraper.datasaver import DataSaver

def _make_temp_records_db():
    path = tempfile.mktemp(suffix=".db")
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE records (
            id INTEGER PRIMARY KEY,
            category TEXT,
            name TEXT,
            phone TEXT,
            google_maps_url TEXT,
            website TEXT,
            email TEXT,
            business_status TEXT,
            address TEXT,
            total_reviews TEXT,
            booking_links TEXT,
            rating TEXT,
            hours TEXT,
            latitude REAL,
            longitude REAL,
            country TEXT,
            city TEXT,
            region TEXT,
            source_query TEXT,
            tags TEXT DEFAULT '[]',
            is_favorite INTEGER DEFAULT 0,
            notes TEXT DEFAULT '',
            dedup_hash TEXT UNIQUE,
            scraped_at TEXT,
            updated_at TEXT,
            enriched_company_info TEXT,
            social_profiles TEXT,
            owner_name TEXT,
            ceo_name TEXT,
            coo_name TEXT,
            executives TEXT,
            linkedin_url TEXT,
            is_enriched INTEGER DEFAULT 0
        );
        """
    )
    conn.commit()
    conn.close()
    return path

@patch('app.scraper.datasaver.Communicator.show_message')
@patch('app.scraper.datasaver.Communicator.get_search_query', return_value="TestQuery")
@patch('app.scraper.datasaver.Communicator.get_output_format', return_value="csv")
def test_save_csv(mock_format, mock_query, mock_show):
    with tempfile.TemporaryDirectory() as tmpdir:
        # Patch output path and db path
        output_path = os.path.join(tmpdir, "output/")
        db_path = _make_temp_records_db()

        with patch('app.scraper.datasaver.OUTPUT_PATH', output_path):
            with patch('app.scraper.datasaver.get_connection', return_value=sqlite3.connect(db_path)):
                saver = DataSaver()
                
                data = [
                    {
                        "Name": "Cafe Alpha",
                        "Category": "Cafe",
                        "Phone": "123-456",
                        "Google Maps URL": "https://google.com/maps/@10.0,20.0",
                        "Address": "1 Main St, London, UK"
                    }
                ]
                
                # Run save
                saver.save(data)
                
                # Check CSV file creation
                expected_file = os.path.join(output_path, "TestQuery - GMS output.csv")
                assert os.path.exists(expected_file)
                
                df = pd.read_csv(expected_file)
                assert len(df) == 1
                assert df.iloc[0]["Name"] == "Cafe Alpha"

                # Check SQLite Ingestion
                conn = sqlite3.connect(db_path)
                cursor = conn.cursor()
                row = cursor.execute("SELECT name, category, country, city, region, latitude FROM records").fetchone()
                assert row is not None
                assert row[0] == "Cafe Alpha"
                assert row[1] == "Cafe"
                assert row[2] == "UK"
                assert row[3] == "Main St"
                assert row[4] == "London"
                assert row[5] == 10.0
                conn.close()
        
        if os.path.exists(db_path):
            os.remove(db_path)

@patch('app.scraper.datasaver.Communicator.show_message')
@patch('app.scraper.datasaver.Communicator.get_search_query', return_value="TestQuery")
@patch('app.scraper.datasaver.Communicator.get_output_format', return_value="json")
def test_save_json_and_conflict_naming(mock_format, mock_query, mock_show):
    with tempfile.TemporaryDirectory() as tmpdir:
        output_path = os.path.join(tmpdir, "output/")
        db_path = _make_temp_records_db()

        with patch('app.scraper.datasaver.OUTPUT_PATH', output_path):
            with patch('app.scraper.datasaver.get_connection', return_value=sqlite3.connect(db_path)):
                os.makedirs(output_path)
                # Create duplicate file to force suffix index
                dup_file = os.path.join(output_path, "TestQuery - GMS output.json")
                with open(dup_file, "w") as f:
                    f.write("[]")

                saver = DataSaver()
                data = [{"Name": "Cafe Beta"}]
                
                saver.save(data)
                
                # It should write with suffix (1)
                conflict_file = os.path.join(output_path, "TestQuery - GMS output (1).json")
                assert os.path.exists(conflict_file)
                
                df = pd.read_json(conflict_file)
                assert len(df) == 1
                assert df.iloc[0]["Name"] == "Cafe Beta"

        if os.path.exists(db_path):
            os.remove(db_path)
