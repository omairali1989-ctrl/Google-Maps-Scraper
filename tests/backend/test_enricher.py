import pytest
import os
import sys
import sqlite3
import tempfile
import json
from unittest.mock import patch, MagicMock
import requests

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../app')))

from app.scraper.enricher import LeadEnricher

@pytest.fixture(autouse=True)
def mock_communicator(monkeypatch):
  monkeypatch.setattr("app.scraper.enricher.Communicator.show_message", MagicMock())

def _make_temp_db_with_enrichment_tables():
    path = tempfile.mktemp(suffix=".db")
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE api_keys (
            id INTEGER PRIMARY KEY,
            provider TEXT UNIQUE,
            api_key TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE enrichment_usage (
            id INTEGER PRIMARY KEY,
            provider TEXT,
            model TEXT,
            prompt_tokens INTEGER,
            completion_tokens INTEGER,
            created_at TEXT DEFAULT (datetime('now'))
        );
        """
    )
    conn.commit()
    conn.close()
    return path

def test_load_api_keys():
    db_path = _make_temp_db_with_enrichment_tables()
    try:
        # Seed active and inactive keys
        conn = sqlite3.connect(db_path)
        conn.execute("INSERT INTO api_keys (provider, api_key, is_active) VALUES ('claude', 'claude-key-123', 1)")
        conn.execute("INSERT INTO api_keys (provider, api_key, is_active) VALUES ('gemini', 'gemini-key-123', 1)")
        conn.execute("INSERT INTO api_keys (provider, api_key, is_active) VALUES ('openai', 'openai-key-disabled', 0)")
        conn.commit()
        conn.close()

        enricher = LeadEnricher(db_path)
        assert "claude" in enricher.api_keys
        assert enricher.api_keys["claude"] == "claude-key-123"
        assert "gemini" in enricher.api_keys
        assert enricher.api_keys["gemini"] == "gemini-key-123"
        assert "openai" not in enricher.api_keys
    finally:
        if os.path.exists(db_path):
            os.remove(db_path)

def test_get_provider_config():
    # Use a dummy DB path
    enricher = LeadEnricher("dummy.db")
    
    # Test valid providers
    claude_config = enricher._get_provider_config("claude")
    assert claude_config is not None
    assert "anthropic.com" in claude_config["url"]

    gemini_config = enricher._get_provider_config("gemini")
    assert gemini_config is not None
    assert gemini_config["url"] == "gemini"

    # Test invalid provider
    invalid_config = enricher._get_provider_config("unknown")
    assert invalid_config is None

def test_extract_text_from_html():
    enricher = LeadEnricher("dummy.db")
    
    html = "<html><body><script>var x=1;</script><h1>Test Title</h1><p>Some text   with spaces.</p></body></html>"
    text = enricher.extract_text_from_html(html)
    
    assert "var x=1;" not in text
    assert "Test Title" in text
    assert "Some text" in text

def test_local_fallback_enrichment():
    enricher = LeadEnricher("dummy.db")
    html = """
    <html>
    <body>
        <h1>Welcome to TechCorp</h1>
        <p>TechCorp is a leading technology company that specializes in AI solutions. We build the future.</p>
        <a href="https://linkedin.com/company/techcorp">LinkedIn</a>
        <a href="https://twitter.com/techcorp">Twitter</a>
    </body>
    </html>
    """
    
    # Test fallback when API key is missing
    result = enricher.enrich_lead(html, "TechCorp", provider="missing_provider")
    
    assert result is not None
    assert result["is_enriched"] == 1
    assert "TechCorp is a leading technology company" in result["enriched_company_info"]
    assert "https://linkedin.com/company/techcorp" in result["social_profiles"]
    assert "https://twitter.com/techcorp" in result["social_profiles"]
    assert result["linkedin_url"] == "https://linkedin.com/company/techcorp"

    # Test fallback when provider explicitly requested as local
    result_local = enricher.enrich_lead(html, "TechCorp", provider="local")
    assert result_local is not None
    assert result_local["is_enriched"] == 1
    assert "TechCorp is a leading technology company" in result_local["enriched_company_info"]

@patch('requests.post')
def test_enrich_lead_claude_success(mock_post):
    db_path = _make_temp_db_with_enrichment_tables()
    try:
        # Seed key
        conn = sqlite3.connect(db_path)
        conn.execute("INSERT INTO api_keys (provider, api_key, is_active) VALUES ('claude', 'sk-ant-123', 1)")
        conn.commit()
        conn.close()

        enricher = LeadEnricher(db_path)
        
        # Mock Claude API response
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "content": [{"text": json.dumps({
                "enriched_company_info": "TechCorp is an AI software company.",
                "social_profiles": "https://twitter.com/techcorp",
                "owner_name": "Jane Owner",
                "ceo_name": "John CEO",
                "coo_name": None,
                "executives": None,
                "linkedin_url": "https://linkedin.com/company/techcorp"
            })}],
            "usage": {
                "input_tokens": 100,
                "output_tokens": 50
            }
        }
        mock_post.return_value = mock_response

        # Execute
        html = "<html><body><h1>TechCorp</h1><p>We build AI stuff.</p></body></html>"
        result = enricher.enrich_lead(html, "TechCorp", provider="claude", model="claude-3-haiku")
        
        assert result is not None
        assert result["is_enriched"] == 1
        assert result["enriched_company_info"] == "TechCorp is an AI software company."
        assert result["owner_name"] == "Jane Owner"
        
        # Verify usage was logged in database
        conn = sqlite3.connect(db_path)
        row = conn.execute("SELECT provider, model, prompt_tokens, completion_tokens FROM enrichment_usage").fetchone()
        assert row is not None
        assert row[0] == "claude"
        assert row[1] == "claude-3-haiku"
        assert row[2] == 100
        assert row[3] == 50
        conn.close()

    finally:
        if os.path.exists(db_path):
            os.remove(db_path)

@patch('requests.post')
def test_enrich_lead_gemini_success(mock_post):
    db_path = _make_temp_db_with_enrichment_tables()
    try:
        conn = sqlite3.connect(db_path)
        conn.execute("INSERT INTO api_keys (provider, api_key, is_active) VALUES ('gemini', 'gem-123', 1)")
        conn.commit()
        conn.close()

        enricher = LeadEnricher(db_path)
        
        # Mock Gemini API response
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "candidates": [{
                "content": {
                    "parts": [{"text": json.dumps({
                        "enriched_company_info": "Gemini Corp builds LLM applications.",
                        "social_profiles": "",
                        "owner_name": None,
                        "ceo_name": "Sundar",
                        "coo_name": None,
                        "executives": None,
                        "linkedin_url": None
                    })}]
                }
            }],
            "usageMetadata": {
                "promptTokenCount": 200,
                "candidatesTokenCount": 75
            }
        }
        mock_post.return_value = mock_response

        html = "<html><body><h1>Gemini Corp</h1></body></html>"
        result = enricher.enrich_lead(html, "Gemini Corp", provider="gemini", model="gemini-1.5-flash")
        
        assert result is not None
        assert result["is_enriched"] == 1
        assert result["ceo_name"] == "Sundar"

        # Verify usage was logged
        conn = sqlite3.connect(db_path)
        row = conn.execute("SELECT provider, model, prompt_tokens, completion_tokens FROM enrichment_usage").fetchone()
        assert row is not None
        assert row[0] == "gemini"
        assert row[2] == 200
        assert row[3] == 75
        conn.close()

    finally:
        if os.path.exists(db_path):
            os.remove(db_path)

@patch('requests.post')
def test_enrich_lead_openai_success(mock_post):
    db_path = _make_temp_db_with_enrichment_tables()
    try:
        conn = sqlite3.connect(db_path)
        conn.execute("INSERT INTO api_keys (provider, api_key, is_active) VALUES ('openai', 'op-123', 1)")
        conn.commit()
        conn.close()

        enricher = LeadEnricher(db_path)
        
        # Mock OpenAI API response
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "choices": [{
                "message": {
                    "content": json.dumps({
                        "enriched_company_info": "OpenAI Corp does research.",
                        "social_profiles": "",
                        "owner_name": None,
                        "ceo_name": "Sam Altman",
                        "coo_name": None,
                        "executives": None,
                        "linkedin_url": None
                    })
                }
            }],
            "usage": {
                "prompt_tokens": 150,
                "completion_tokens": 60
            }
        }
        mock_post.return_value = mock_response

        html = "<html><body><h1>OpenAI Corp</h1></body></html>"
        result = enricher.enrich_lead(html, "OpenAI Corp", provider="openai", model="gpt-4o")
        
        assert result is not None
        assert result["ceo_name"] == "Sam Altman"

        # Verify usage logged
        conn = sqlite3.connect(db_path)
        row = conn.execute("SELECT provider, model, prompt_tokens, completion_tokens FROM enrichment_usage").fetchone()
        assert row is not None
        assert row[0] == "openai"
        assert row[2] == 150
        assert row[3] == 60
        conn.close()

    finally:
        if os.path.exists(db_path):
            os.remove(db_path)

@patch('requests.post')
def test_enrich_lead_api_error_fallback(mock_post):
    db_path = _make_temp_db_with_enrichment_tables()
    try:
        conn = sqlite3.connect(db_path)
        conn.execute("INSERT INTO api_keys (provider, api_key, is_active) VALUES ('openai', 'op-123', 1)")
        conn.commit()
        conn.close()

        enricher = LeadEnricher(db_path)
        
        # Mock requests.post raising error
        mock_post.side_effect = requests.exceptions.RequestException("Connection error")

        html = "<html><body><h1>OpenAI Corp</h1><p>OpenAI Corp is a non-profit company.</p></body></html>"
        result = enricher.enrich_lead(html, "OpenAI Corp", provider="openai", model="gpt-4o")
        
        # Fallback to local extraction should trigger
        assert result is not None
        assert result["is_enriched"] == 1
        assert "OpenAI Corp is a non-profit company" in result["enriched_company_info"]

    finally:
        if os.path.exists(db_path):
            os.remove(db_path)

@patch('requests.post')
def test_enrich_lead_json_decode_error_fallback(mock_post):
    db_path = _make_temp_db_with_enrichment_tables()
    try:
        conn = sqlite3.connect(db_path)
        conn.execute("INSERT INTO api_keys (provider, api_key, is_active) VALUES ('openai', 'op-123', 1)")
        conn.commit()
        conn.close()

        enricher = LeadEnricher(db_path)
        
        # Mock OpenAI API response returning non-JSON text
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "choices": [{
                "message": {
                    "content": "This is not valid JSON string"
                }
            }],
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 50
            }
        }
        mock_post.return_value = mock_response

        html = "<html><body><h1>OpenAI Corp</h1><p>OpenAI Corp is a research company.</p></body></html>"
        result = enricher.enrich_lead(html, "OpenAI Corp", provider="openai", model="gpt-4o")
        
        # Fallback to local extraction should trigger
        assert result is not None
        assert result["is_enriched"] == 1
        assert "OpenAI Corp is a research company" in result["enriched_company_info"]

    finally:
        if os.path.exists(db_path):
            os.remove(db_path)

def test_hybrid_enrichment_mode():
    db_path = "test_hybrid_enrich.db"
    if os.path.exists(db_path):
        os.remove(db_path)
        
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS api_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider TEXT UNIQUE,
                api_key TEXT,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP,
                updated_at TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS enrichment_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider TEXT,
                model TEXT,
                prompt_tokens INTEGER,
                completion_tokens INTEGER,
                created_at TIMESTAMP
            )
        ''')
        cursor.execute("INSERT INTO api_keys (provider, api_key, is_active) VALUES ('openai', 'mock-openai-key', 1)")
        conn.commit()
        conn.close()
        
        enricher = LeadEnricher(db_path)
        
        with patch('requests.post') as mock_post:
            mock_response = MagicMock()
            mock_response.json.return_value = {
                "choices": [{
                    "message": {
                        "content": '{"enriched_company_info": "AI summary of OpenAI Corp", "social_profiles": "https://facebook.com/openaicorp", "owner_name": "Sam Altman", "ceo_name": "Sam Altman", "coo_name": null, "executives": null, "linkedin_url": null}'
                    }
                }],
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 5
                }
            }
            mock_post.return_value = mock_response
            
            html = """
            <html>
                <body>
                    <h1>OpenAI Corp</h1>
                    <p>OpenAI Corp makes advanced AI models.</p>
                    <a href="https://twitter.com/openaicorp">Twitter</a>
                    <a href="https://linkedin.com/company/openai">LinkedIn</a>
                </body>
            </html>
            """
            
            result = enricher.enrich_lead(html, "OpenAI Corp", provider="mix", model="mix")
            
            assert result is not None
            assert result["is_enriched"] == 1
            assert result["ceo_name"] == "Sam Altman"
            assert result["enriched_company_info"] == "AI summary of OpenAI Corp"
            
            profiles = [p.strip() for p in result["social_profiles"].split(",")]
            assert "https://facebook.com/openaicorp" in profiles
            assert "https://twitter.com/openaicorp" in profiles
            assert "https://linkedin.com/company/openai" in profiles
            
            assert result["linkedin_url"] == "https://linkedin.com/company/openai"
            
    finally:
        if os.path.exists(db_path):
            os.remove(db_path)


# =====================================================================
# Enhanced Local Enricher — new extraction function tests
# =====================================================================

def test_local_enricher_extracts_emails():
    enricher = LeadEnricher("dummy.db")
    html = """
    <html><body>
        <p>Contact us at info@acmecorp.com or sales@acmecorp.com</p>
        <a href="mailto:support@acmecorp.com">Email Support</a>
        <!-- Junk emails that should be filtered -->
        <p>icon@2x.png noreply@example.com</p>
    </body></html>
    """
    result = enricher.enrich_lead(html, "AcmeCorp", provider="local")
    assert result is not None
    assert result["is_enriched"] == 1
    assert result["emails"] is not None
    emails = result["emails"].split(",")
    assert "info@acmecorp.com" in emails
    assert "sales@acmecorp.com" in emails
    assert result["email_primary"] is not None
    # Junk should be excluded
    assert "icon@2x.png" not in result["emails"]


def test_local_enricher_extracts_phones():
    enricher = LeadEnricher("dummy.db")
    html = """
    <html><body>
        <a href="tel:+14155551234">Call us</a>
        <p>Phone: +1 (415) 555-1234</p>
    </body></html>
    """
    result = enricher.enrich_lead(html, "PhoneCo", provider="local")
    assert result is not None
    assert result["phones"] is not None
    assert result["phone_primary"] is not None


def test_local_enricher_extracts_whatsapp():
    enricher = LeadEnricher("dummy.db")
    html = """
    <html><body>
        <a href="https://wa.me/971501234567">WhatsApp us</a>
        <a href="https://api.whatsapp.com/send?phone=971509876543">Chat</a>
    </body></html>
    """
    result = enricher.enrich_lead(html, "WhatsAppCo", provider="local")
    assert result is not None
    assert result["whatsapp"] is not None
    whatsapp_nums = result["whatsapp"].split(",")
    assert len(whatsapp_nums) >= 1


def test_local_enricher_extracts_social_profiles():
    enricher = LeadEnricher("dummy.db")
    html = """
    <html><body>
        <a href="https://facebook.com/acmecorp">Facebook</a>
        <a href="https://instagram.com/acmecorp">Instagram</a>
        <a href="https://linkedin.com/company/acmecorp">LinkedIn</a>
        <a href="https://twitter.com/acmecorp">Twitter</a>
        <a href="https://youtube.com/c/acmecorp">YouTube</a>
        <a href="https://tiktok.com/@acmecorp">TikTok</a>
        <a href="https://github.com/acmecorp">GitHub</a>
    </body></html>
    """
    result = enricher.enrich_lead(html, "AcmeCorp", provider="local")
    assert result is not None
    profiles = result["social_profiles"]
    assert profiles is not None
    assert "linkedin.com" in profiles
    assert "facebook.com" in profiles
    assert "instagram.com" in profiles
    assert result["linkedin_url"] is not None
    assert "linkedin.com" in result["linkedin_url"]


def test_local_enricher_extracts_address_from_jsonld():
    enricher = LeadEnricher("dummy.db")
    html = """
    <html><head>
        <script type="application/ld+json">
        {
            "@type": "LocalBusiness",
            "name": "Acme Corp",
            "address": {
                "@type": "PostalAddress",
                "streetAddress": "123 Main Street",
                "addressLocality": "San Francisco",
                "addressRegion": "CA",
                "postalCode": "94105",
                "addressCountry": "US"
            }
        }
        </script>
    </head>
    <body><p>Acme Corp is a wonderful company.</p></body>
    </html>
    """
    result = enricher.enrich_lead(html, "Acme Corp", provider="local")
    assert result is not None
    assert result["address"] is not None
    assert "123 Main Street" in result["address"]
    assert "San Francisco" in result["address"]
    assert "CA" in result["address"]
    assert "94105" in result["address"]


def test_local_enricher_extracts_business_hours_from_jsonld():
    enricher = LeadEnricher("dummy.db")
    html = """
    <html><head>
        <script type="application/ld+json">
        {
            "@type": "LocalBusiness",
            "name": "HoursCo",
            "openingHoursSpecification": [
                {"dayOfWeek": "Monday", "opens": "09:00", "closes": "17:00"},
                {"dayOfWeek": "Tuesday", "opens": "09:00", "closes": "17:00"}
            ]
        }
        </script>
    </head>
    <body><p>HoursCo is a great company.</p></body>
    </html>
    """
    result = enricher.enrich_lead(html, "HoursCo", provider="local")
    assert result is not None
    assert result["business_hours"] is not None
    assert "Monday" in result["business_hours"]
    assert "09:00" in result["business_hours"]


def test_local_enricher_detects_technologies():
    enricher = LeadEnricher("dummy.db")
    html = """
    <html><head>
        <link rel="stylesheet" href="/wp-content/themes/style.css" />
        <script src="https://www.googletagmanager.com/gtm.js?id=123"></script>
        <script src="https://js.stripe.com/v3/"></script>
    </head>
    <body><p>TechDetect is a cool company.</p></body>
    </html>
    """
    result = enricher.enrich_lead(html, "TechDetect", provider="local")
    assert result is not None
    assert result["technologies"] is not None
    techs = result["technologies"].split(",")
    assert "WordPress" in techs
    assert "Google Tag Manager" in techs
    assert "Stripe" in techs


def test_local_enricher_extracts_executive_names():
    enricher = LeadEnricher("dummy.db")
    html = """
    <html><head>
        <script type="application/ld+json">
        {
            "@type": "Organization",
            "name": "ExecCorp",
            "founder": {"@type": "Person", "name": "Alice Johnson"}
        }
        </script>
    </head>
    <body>
        <p>ExecCorp was founded by Alice Johnson.</p>
        <p>Our CEO: Bob Williams leads the company.</p>
        <p>COO: Carol Davis oversees operations.</p>
        <p>VP of Sales: Dave Brown drives revenue.</p>
    </body>
    </html>
    """
    result = enricher.enrich_lead(html, "ExecCorp", provider="local")
    assert result is not None
    assert result["owner_name"] == "Alice Johnson"
    assert result["ceo_name"] == "Bob Williams"
    assert result["coo_name"] == "Carol Davis"
    assert result["executives"] is not None
    assert "Dave Brown" in result["executives"]


def test_local_enricher_lead_scoring():
    enricher = LeadEnricher("dummy.db")
    # Rich lead with many signals
    html_rich = """
    <html><body>
        <a href="mailto:info@richco.com">Email</a>
        <a href="tel:+14155551234">Call</a>
        <a href="https://wa.me/14155551234">WhatsApp</a>
        <a href="https://linkedin.com/company/richco">LinkedIn</a>
        <a href="https://facebook.com/richco">Facebook</a>
        <a href="https://instagram.com/richco">Instagram</a>
        <p>RichCo is a premium services firm.</p>
    </body></html>
    """
    result_rich = enricher.enrich_lead(html_rich, "RichCo", provider="local")
    assert result_rich is not None
    assert result_rich["lead_score"] >= 70  # high score for many signals

    # Poor lead with minimal info
    html_poor = "<html><body><p>PoorCo has minimal info.</p></body></html>"
    result_poor = enricher.enrich_lead(html_poor, "PoorCo", provider="local")
    assert result_poor is not None
    assert result_poor["lead_score"] < 20  # low score for no signals


def test_local_enricher_meta_description():
    enricher = LeadEnricher("dummy.db")
    html = """
    <html>
    <head>
        <title>MetaCorp - Best Solutions</title>
        <meta name="description" content="MetaCorp provides world-class enterprise solutions for businesses.">
    </head>
    <body><p>Some body content here.</p></body>
    </html>
    """
    result = enricher.enrich_lead(html, "MetaCorp", provider="local")
    assert result is not None
    assert result["website_title"] is not None
    assert "MetaCorp" in result["website_title"]
    assert result["website_description"] is not None
    assert "enterprise solutions" in result["website_description"]
    # Company info should prefer meta description
    assert "enterprise solutions" in result["enriched_company_info"]


def test_local_enricher_full_integration():
    """Full integration test: a realistic HTML page with all enrichable data."""
    enricher = LeadEnricher("dummy.db")
    html = """
    <html>
    <head>
        <title>Omega Solutions - Digital Agency</title>
        <meta name="description" content="Omega Solutions is a full-service digital marketing agency.">
        <script type="application/ld+json">
        {
            "@type": "Organization",
            "name": "Omega Solutions",
            "founder": {"@type": "Person", "name": "Sarah Connor"},
            "address": {
                "@type": "PostalAddress",
                "streetAddress": "456 Tech Park",
                "addressLocality": "Austin",
                "addressRegion": "TX",
                "postalCode": "73301"
            },
            "openingHours": "Mo-Fr 09:00-18:00"
        }
        </script>
        <link rel="stylesheet" href="/wp-content/themes/theme/style.css" />
        <script src="https://www.googletagmanager.com/gtm.js"></script>
    </head>
    <body>
        <p>Omega Solutions is a full-service digital marketing agency.</p>
        <p>CEO: Mark Spencer leads our global operations.</p>
        <a href="mailto:hello@omegasolutions.com">Email us</a>
        <a href="tel:+15125551234">Call</a>
        <a href="https://wa.me/15125551234">WhatsApp</a>
        <a href="https://linkedin.com/company/omegasolutions">LinkedIn</a>
        <a href="https://facebook.com/omegasolutions">Facebook</a>
        <a href="https://instagram.com/omegasolutions">Instagram</a>
        <a href="https://twitter.com/omegasolutions">Twitter</a>
        <script src="https://static.hotjar.com/c/hotjar-123.js"></script>
    </body>
    </html>
    """
    result = enricher.enrich_lead(html, "Omega Solutions", provider="local")

    assert result is not None
    assert result["is_enriched"] == 1

    # Company info from meta description
    assert "digital marketing agency" in result["enriched_company_info"]

    # Emails
    assert "hello@omegasolutions.com" in result["emails"]
    assert result["email_primary"] is not None

    # Phones
    assert result["phones"] is not None
    assert result["phone_primary"] is not None

    # WhatsApp
    assert result["whatsapp"] is not None

    # Social profiles
    assert "linkedin.com" in result["social_profiles"]
    assert "facebook.com" in result["social_profiles"]
    assert result["linkedin_url"] is not None

    # Address from JSON-LD
    assert "456 Tech Park" in result["address"]
    assert "Austin" in result["address"]

    # Business hours
    assert result["business_hours"] is not None

    # Technologies
    assert "WordPress" in result["technologies"]
    assert "Google Tag Manager" in result["technologies"]
    assert "Hotjar" in result["technologies"]

    # Executives
    assert result["owner_name"] == "Sarah Connor"
    assert result["ceo_name"] == "Mark Spencer"

    # Lead score should be high
    assert result["lead_score"] >= 70

    # Website meta
    assert "Omega Solutions" in result["website_title"]
    assert result["website_description"] is not None
