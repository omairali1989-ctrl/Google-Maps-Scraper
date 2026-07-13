"""Unit tests for the website (non-AI) enrichment modules.

These are all offline/pure — no network — exercising extraction, validation,
scoring and dedup against static HTML and dicts.
"""

import pytest
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../app')))

from app.scraper.webenrich import extract, validate, scoring
from app.scraper.webenrich.crawler import normalize_url, registrable_domain


SAMPLE_HTML = """
<html><head>
  <title>Acme Widgets — Home</title>
  <meta name="description" content="We build the best widgets in town.">
</head><body>
  <a href="mailto:info@acmewidgets.com">Email us</a>
  <a href="mailto:noise@2x.png">bad</a>
  <a href="tel:+1 (415) 555-0132">Call</a>
  <a href="https://www.facebook.com/acmewidgets">fb</a>
  <a href="https://twitter.com/intent/tweet?url=x">share</a>
  <a href="https://www.linkedin.com/company/acme">li</a>
  <a href="https://www.youtube.com/watch?v=abc">video</a>
  <a href="https://wa.me/14155550132">WhatsApp</a>
  <p>Established 2001-2026. Version 2025 99.999.</p>
</body></html>
"""


# --- extraction ----------------------------------------------------------- #
def test_extract_title_description():
    meta = extract.extract_title_description(SAMPLE_HTML)
    assert meta["title"] == "Acme Widgets — Home"
    assert "widgets" in meta["description"].lower()


def test_extract_emails_filters_junk():
    emails = extract.extract_emails(SAMPLE_HTML)
    assert "info@acmewidgets.com" in emails
    # image-asset false positive must be dropped
    assert not any(".png" in e for e in emails)


def test_extract_phones_rejects_year_ranges_and_versions():
    phones = extract.extract_phones(SAMPLE_HTML)
    # The tel: link is trusted; year-range / version strings must NOT appear.
    assert any("415" in p for p in phones)
    assert not any(p.strip() in ("2001-2026", "2025 99.999") for p in phones)


def test_extract_socials_only_real_profiles():
    socials = extract.extract_socials(SAMPLE_HTML)
    assert socials.get("facebook", "").endswith("/acmewidgets")
    assert "linkedin" in socials
    # twitter "intent" share link and youtube "/watch" are not profiles
    assert "twitter" not in socials
    assert "youtube" not in socials


def test_extract_whatsapp():
    wa = extract.extract_whatsapp(SAMPLE_HTML)
    assert "14155550132" in wa


def test_merge_page_extractions():
    merged = extract.merge_page_extractions([SAMPLE_HTML, SAMPLE_HTML])
    assert merged["title"] == "Acme Widgets — Home"
    assert "info@acmewidgets.com" in merged["emails"]


# --- validation ----------------------------------------------------------- #
def test_normalize_email():
    norm, ok = validate.normalize_email("Info@Acme.com")
    assert ok and norm == "info@acme.com"
    _, bad = validate.normalize_email("not-an-email")
    assert bad is False


def test_pick_primary_email_prefers_role_address():
    primary, ok = validate.pick_primary_email(
        ["ceo.personal@acme.com", "info@acme.com"]
    )
    assert ok and primary == "info@acme.com"


def test_normalize_phone_e164():
    norm, ok = validate.normalize_phone("+1 415 555 0132")
    assert ok and norm == "+14155550132"


def test_region_for_country():
    assert validate.region_for_country("United States") == "US"
    assert validate.region_for_country("uae") == "AE"
    assert validate.region_for_country("Narnia") is None


# --- scoring -------------------------------------------------------------- #
def test_score_lead_additive():
    result = scoring.score_lead({
        "website": "https://acme.com",
        "https": True,
        "email_valid": True,
        "phone_valid": True,
        "socials": {"linkedin": "x", "facebook": "y"},
        "rating": "4.8",
        "review_count": "150",
    })
    assert result["score"] > 60
    assert result["grade"] in ("A", "B")
    assert result["breakdown"]["https"] == 10


def test_score_lead_empty_is_zero():
    result = scoring.score_lead({})
    assert result["score"] == 0
    assert result["grade"] == "D"


# --- crawler helpers ------------------------------------------------------ #
def test_normalize_url_adds_scheme():
    assert normalize_url("acme.com") == "https://acme.com"
    assert normalize_url("http://x.com") == "http://x.com"
    assert normalize_url("") is None


def test_registrable_domain_strips_www():
    assert registrable_domain("https://www.acme.co.uk/path") == "acme.co.uk"
