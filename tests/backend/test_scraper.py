import pytest
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../app')))

from unittest.mock import patch, MagicMock
from app.scraper.scraper import Backend

@patch('selenium.webdriver.Chrome')
@patch('app.scraper.scraper.Scroller')
def test_backend_multiscraper_queries(mock_scroller, mock_chrome):
    # Test that Backend.mainscraping splits a comma separated list of queries correctly
    
    # We mock Communicator.show_message to prevent printing
    with patch('app.scraper.scraper.Communicator.show_message') as mock_show_message:
        with patch('app.scraper.scraper.Communicator.end_processing') as mock_end_processing:
            # Mock Common.close_thread_is_set to return False so it doesn't stop immediately
            with patch('app.scraper.scraper.Common.close_thread_is_set', return_value=False):
                # Also patch sleep to make the test run fast
                with patch('app.scraper.scraper.Common.smart_sleep'):
                    # We provide a multi query
                    backend = Backend("Cafes in Lahore, Restaurants in Karachi\nGyms in Islamabad", "excel", 1, job_id="test_job")
                    
                    # Mock the scroller inside backend
                    backend.scroller = mock_scroller.return_value
                    
                    # Mock openingurl to avoid real requests
                    backend.openingurl = MagicMock()
                    
                    # Run the main scraping loop
                    backend.mainscraping()
                    
                    # It should have called scroller.scroll() 3 times
                    assert backend.scroller.scroll.call_count == 3
                    
                    # It should have opened the URL for each query
                    assert backend.openingurl.call_count == 3
                    
                    calls = backend.openingurl.call_args_list
                    urls_opened = [call[1].get('url') or call[0][0] for call in calls]
                    
                    assert any("Cafes+in+Lahore" in url for url in urls_opened)
                    assert any("Restaurants+in+Karachi" in url for url in urls_opened)
                    assert any("Gyms+in+Islamabad" in url for url in urls_opened)
