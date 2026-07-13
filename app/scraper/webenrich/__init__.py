"""
Website (non-AI) lead-enrichment package.

Given a business website, asynchronously crawls a handful of high-signal pages
(homepage / contact / about / sitemap-discovered) and extracts contact and
social data, then validates + scores the lead. Pure-library, no browser, no LLM.

Public entry points:
    enrich_website(url, ...)  -> EnrichmentResult   (single site, async)
"""

from .models import EnrichmentResult
from .pipeline import enrich_website

__all__ = ["EnrichmentResult", "enrich_website"]
