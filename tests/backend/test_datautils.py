import pytest
import sys
import os
import sqlite3
import tempfile
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../app')))

from app.scraper.datautils import (
    compute_dedup_hash,
    extract_coordinates,
    parse_address,
    is_valid_record,
    filter_previously_scraped
)

def test_compute_dedup_hash():
    hash1 = compute_dedup_hash("Cafe Paris", "123 Main St", "555-1234")
    hash2 = compute_dedup_hash("cafe paris ", " 123 main st", "555-1234")
    # Should be case insensitive and strip whitespace
    assert hash1 == hash2

    hash3 = compute_dedup_hash("Different Name", "123 Main St", "555-1234")
    assert hash1 != hash3

def test_extract_coordinates():
    # Test URL pattern 1: @lat,lng
    url1 = "https://www.google.com/maps/place/Cafe/@37.7749,-122.4194,15z"
    lat, lng = extract_coordinates(url1)
    assert lat == 37.7749
    assert lng == -122.4194

    # Test URL pattern 2: !3dlat!4dlng
    url2 = "https://www.google.com/maps/place/Cafe/data=!4m2!3m1!1s0x0:0x0!3m1!4b1!4m5!3m4!1s0x0:0x0!8m2!3d37.7749!4d-122.4194"
    lat, lng = extract_coordinates(url2)
    assert lat == 37.7749
    assert lng == -122.4194

    # Test invalid URL
    lat, lng = extract_coordinates("https://www.google.com/maps/place/Cafe")
    assert lat is None
    assert lng is None

def test_parse_address():
    # Pattern: Street, City, Region Zip, Country
    addr1 = "123 Main St, Seattle, WA 98101, USA"
    country, city, region = parse_address(addr1)
    assert country == "USA"
    assert city == "Seattle"
    assert region == "WA"

    # Pattern: Simple street, city, country
    addr2 = "Champs-Élysées, Paris, France"
    country, city, region = parse_address(addr2)
    assert country == "France"
    assert city == "Champs-Élysées"
    assert region == "Paris"

    # Empty address
    country, city, region = parse_address("")
    assert country is None
    assert city is None
    assert region is None

def test_is_valid_record():
    assert is_valid_record({"Name": "Valid Cafe"}) is True
    assert is_valid_record({"name": "Valid Cafe"}) is True
    assert is_valid_record({"Name": "  "}) is False
    assert is_valid_record({"Phone": "555-1234"}) is False
    assert is_valid_record("not a dict") is False

def test_filter_previously_scraped_no_dedup():
    # If no db queries run or flag is 0, return unchanged
    with patch('db.get_connection') as mock_conn:
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = (1, 0) # user_id=1, skip_previously_scraped=0
        mock_conn.return_value.cursor.return_value = mock_cursor
        
        urls = ["http://maps.google.com/1", "http://maps.google.com/2"]
        kept, skipped = filter_previously_scraped("job-123", urls)
        assert kept == urls
        assert skipped == 0

def test_filter_previously_scraped_with_dedup():
    # If flag is 1, filter seen URLs
    db_path = tempfile.mktemp(suffix=".db")
    try:
        conn = sqlite3.connect(db_path)
        conn.executescript(
            """
            CREATE TABLE scrape_jobs (id TEXT, user_id INTEGER, skip_previously_scraped INTEGER);
            CREATE TABLE records (user_id INTEGER, google_maps_url TEXT);
            
            INSERT INTO scrape_jobs (id, user_id, skip_previously_scraped) VALUES ('job-123', 42, 1);
            INSERT INTO records (user_id, google_maps_url) VALUES (42, 'http://maps.google.com/already-scraped');
            """
        )
        conn.commit()
        conn.close()

        with patch('db.get_connection', return_value=sqlite3.connect(db_path)):
            urls = ["http://maps.google.com/already-scraped", "http://maps.google.com/new-place"]
            kept, skipped = filter_previously_scraped("job-123", urls)
            
            assert kept == ["http://maps.google.com/new-place"]
            assert skipped == 1
    finally:
        if os.path.exists(db_path):
            os.remove(db_path)
