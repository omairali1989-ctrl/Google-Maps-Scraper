import pytest
import sys
import os
import re
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../app')))

from app.scraper.parser import Parser

@pytest.fixture(autouse=True)
def mock_communicator(monkeypatch):
    monkeypatch.setattr("app.scraper.parser.Communicator.show_message", MagicMock())
    monkeypatch.setattr("app.scraper.parser.Communicator.show_error_message", MagicMock())

@patch('app.scraper.parser.netpolicy.get')
def test_find_mail_direct_success(mock_get):
    # Mock home page containing an email
    mock_response = MagicMock()
    mock_response.url = "https://example.com"
    mock_response.text = "Hello, contact us at contact@example.com or support@example.com"
    mock_response.status_code = 200
    mock_get.return_value = mock_response

    parser = Parser(MagicMock())
    email = parser.find_mail("example.com")
    
    # The set of found emails can be in any order, so check presence
    assert "contact@example.com" in email
    assert "support@example.com" in email

@patch('app.scraper.parser.netpolicy.get')
def test_find_mail_sub_pages_fallback(mock_get):
    # Mock home page with no email, but contact page contains email
    mock_home = MagicMock()
    mock_home.url = "https://example.com/"
    mock_home.text = "No email here"
    mock_home.status_code = 200

    mock_contact = MagicMock()
    mock_contact.url = "https://example.com/contact"
    mock_contact.text = "Our email is info@example.com"
    mock_contact.status_code = 200

    # Side effect returns home for main url, contact for /contact
    def get_side_effect(url, **kwargs):
        if "/contact" in url:
            return mock_contact
        return mock_home

    mock_get.side_effect = get_side_effect

    parser = Parser(MagicMock())
    email = parser.find_mail("https://example.com")
    
    assert email == "info@example.com"

def test_parse_google_maps_card():
    # Mock selenium driver and [role='main'] element
    mock_element = MagicMock()
    mock_element.get_attribute.return_value = """
    <div role="main">
        <div class="tAiQdd">
            <h1 class="DUwDvf">Cafe Majestic</h1>
        </div>
        <span class="ceNzKf" aria-label="4.5 stars">4.5</span>
        <div class="F7nice"><span>4.5</span><span>(120 reviews)</span></div>
        <button class="CsEnBe" data-tooltip="Copy address">
            <div class="rogA2c">123 Main St, London, UK</div>
        </button>
        <button class="CsEnBe" data-tooltip="Copy phone number">
            <div class="rogA2c">+44 20 7946 0958</div>
        </button>
        <a aria-label="Website: cafe-majestic.com" href="http://cafe-majestic.com">Website</a>
        <button class="DkEaL">Cafe</button>
        <span class="ZDu9vd"><span>Open</span></span>
    </div>
    """
    
    mock_driver = MagicMock()
    mock_driver.execute_script.return_value = mock_element
    mock_driver.current_url = "https://google.com/maps/place/Cafe+Majestic"

    parser = Parser(mock_driver)
    
    # Mock find_mail to avoid external network policy calls
    parser.find_mail = MagicMock(return_value="contact@cafe-majestic.com")
    
    parser.parse()
    
    assert len(parser.finalData) == 1
    data = parser.finalData[0]
    assert data["Name"] == "Cafe Majestic"
    assert data["Rating"] == "4.5"
    assert data["Total Reviews"] == "(120 reviews)"
    assert data["Address"] == "123 Main St, London, UK"
    assert data["Phone"] == "+44 20 7946 0958"
    assert data["Website"] == "http://cafe-majestic.com"
    assert data["email"] == "contact@cafe-majestic.com"
    assert data["Category"] == "Cafe"
    assert data["Business Status"] == "Open"
