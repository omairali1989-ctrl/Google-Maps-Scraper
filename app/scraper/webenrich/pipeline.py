"""
Single-site enrichment pipeline: crawl -> extract -> validate -> score.

`enrich_website` is a pure async function with no DB side effects — it takes a
URL (and optional context) and returns an EnrichmentResult. Persistence and
dedup happen in the orchestrator so this stays unit-testable in isolation.
"""

from typing import Dict, Optional

from .models import EnrichmentResult
from . import crawler, extract, validate, scoring


async def enrich_website(
    url: str,
    country: Optional[str] = None,
    rating: Optional[str] = None,
    review_count: Optional[str] = None,
    max_pages: int = crawler.MAX_PAGES,
    provider: str = "local",
    model: str = "local",
    company_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> EnrichmentResult:
    """Enrich a single business website. Never raises; errors are captured on
    the result's ``error`` field with ``ok=False``."""
    result = EnrichmentResult(url=url)
    norm = crawler.normalize_url(url)
    if not norm:
        result.error = "invalid or empty website URL"
        return result
    result.domain = crawler.registrable_domain(norm)

    try:
        pages = await crawler.crawl_site(norm, max_pages=max_pages)
    except Exception as e:
        result.error = f"crawl failed: {e}"
        return result

    if not pages:
        result.error = "no pages fetched"
        return result

    home = pages[0]
    result.final_url = home.final_url
    result.http_status = home.status
    result.pages_crawled = len(pages)

    # Delegate extraction to LeadEnricher
    enriched = None
    if db_path:
        try:
            from scraper.enricher import LeadEnricher
            all_html = "\n".join(p.html for p in pages if p.html)
            enricher = LeadEnricher(db_path)
            # Run the single lead extraction through the unified method
            import asyncio
            enriched = await asyncio.to_thread(
                enricher.enrich_lead,
                all_html,
                company_name or "Business",
                provider,
                model
            )
        except Exception as e:
            result.error = f"lead enrichment call failed: {e}"

    if enriched:
        result.enriched_company_info = enriched.get("enriched_company_info")
        result.owner_name = enriched.get("owner_name")
        result.ceo_name = enriched.get("ceo_name")
        result.coo_name = enriched.get("coo_name")
        result.executives = enriched.get("executives")
        result.linkedin_url = enriched.get("linkedin_url")

        if enriched.get("emails"):
            result.emails = [e.strip() for e in enriched["emails"].split(",") if e.strip()]
        if enriched.get("phones"):
            result.phones = [p.strip() for p in enriched["phones"].split(",") if p.strip()]
        if enriched.get("whatsapp"):
            result.whatsapp = [w.strip() for w in enriched["whatsapp"].split(",") if w.strip()]
        
        if enriched.get("social_profiles"):
            for p in enriched["social_profiles"].split(","):
                p = p.strip()
                if "facebook.com" in p: result.socials["facebook"] = p
                elif "instagram.com" in p: result.socials["instagram"] = p
                elif "linkedin.com" in p: result.socials["linkedin"] = p
                elif "twitter.com" in p or "x.com" in p: result.socials["twitter"] = p
                elif "youtube.com" in p: result.socials["youtube"] = p
                elif "tiktok.com" in p: result.socials["tiktok"] = p

        result.title = enriched.get("website_title")
        result.description = enriched.get("website_description")

        result.email_valid = 1 if result.emails else 0
        result.phone_valid = 1 if result.phones else 0

        if enriched.get("lead_score") is not None:
            result.lead_score = enriched["lead_score"]
            result.lead_grade = "A" if result.lead_score >= 80 else "B" if result.lead_score >= 60 else "C" if result.lead_score >= 40 else "D"
        result.ok = True
    else:
        # Fallback to local offline parser if LeadEnricher failed or wasn't invoked
        merged = extract.merge_page_extractions([p.html for p in pages])
        result.title = merged["title"]
        result.description = merged["description"]
        result.emails = merged["emails"]
        result.whatsapp = merged["whatsapp"]
        result.socials = merged["socials"]

        region = validate.region_for_country(country)
        result.phones = validate.normalize_all_phones(merged["phones"], region)

        _, email_ok = validate.pick_primary_email(result.emails)
        result.email_valid = email_ok
        _, phone_ok = validate.pick_primary_phone(merged["phones"], region)
        result.phone_valid = phone_ok

        scored = scoring.score_lead(
            {
                "website": norm,
                "https": norm.lower().startswith("https://"),
                "email_valid": bool(email_ok),
                "phone_valid": bool(phone_ok),
                "whatsapp": result.whatsapp,
                "socials": result.socials,
                "rating": rating,
                "review_count": review_count,
            }
        )
        result.lead_score = scored["score"]
        result.lead_grade = scored["grade"]
        result.ok = True

    return result
