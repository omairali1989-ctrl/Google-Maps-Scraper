"""
Contact + social + metadata extraction from crawled HTML.

Works on the raw HTML of one or more pages. Uses selectolax for structured
extraction (title/meta, mailto:/tel: anchors, social hrefs) when available and
falls back to regex so the pipeline degrades gracefully if selectolax is absent.
"""

import re
from typing import Dict, List, Optional
from urllib.parse import urlparse, unquote

try:
    from selectolax.parser import HTMLParser
    _HAS_SELECTOLAX = True
except Exception:  # pragma: no cover
    HTMLParser = None
    _HAS_SELECTOLAX = False


# --- Regexes -------------------------------------------------------------- #
EMAIL_RE = re.compile(
    r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", re.IGNORECASE
)
# Phone: require punctuation typical of real phone formatting (an explicit '+'
# country code, or parentheses/dashes/dots between groups). A bare run of
# space-separated digit groups (e.g. a Fibonacci sequence or a year range)
# should NOT match — that was the source of false positives.
PHONE_RE = re.compile(
    r"(?:\+\d{1,3}[\s.\-]?)?"          # optional +CC
    r"\(?\d{2,4}\)?"                    # first group, optionally parenthesized
    r"(?:[\s.\-]\d{2,4}){1,4}"          # 1-4 more groups joined by . - or space
)
# A phone match is only trusted if it contains at least one of these separators
# (or a leading '+'), which real phone numbers have and incidental digit runs
# usually don't.
_PHONE_SEP_RE = re.compile(r"[+()\-.]")

# Junk emails to drop (sentinels, image assets misparsed, example domains).
EMAIL_BLOCKLIST_SUBSTR = (
    "example.com", "sentry.io", "wixpress.com", "@2x", "@3x",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
    "your-email", "youremail", "email@", "name@",
    "your@email", "you@example", "test@test", "user@domain", "@domain.com",
    "@yourdomain", "@sentry", "@example",
)

SOCIAL_HOSTS = {
    "facebook": ("facebook.com", "fb.com", "fb.me"),
    "instagram": ("instagram.com",),
    "linkedin": ("linkedin.com",),
    "youtube": ("youtube.com", "youtu.be"),
    "tiktok": ("tiktok.com",),
    "twitter": ("twitter.com", "x.com"),
}
# Social profile URLs to ignore (share/intent/embeds/generic, not a real profile).
SOCIAL_IGNORE = (
    "/sharer", "/share", "/intent/", "/plugins/", "/dialog/",
    "/watch", "/embed", "/shorts", "/results", "/hashtag/", "/explore/",
    "/login", "/signup", "/home",
)


def _clean_email(e: str) -> Optional[str]:
    e = e.strip().strip(".").lower()
    if not e or e.count("@") != 1:
        return None
    for bad in EMAIL_BLOCKLIST_SUBSTR:
        if bad in e:
            return None
    if len(e) > 100:
        return None
    return e


def _dedup_keep_order(items: List[str]) -> List[str]:
    seen = set()
    out = []
    for it in items:
        if it and it not in seen:
            seen.add(it)
            out.append(it)
    return out


def extract_title_description(html: str) -> Dict[str, Optional[str]]:
    """Pull <title> and meta description (falling back to og:description)."""
    if not html:
        return {"title": None, "description": None}
    title = None
    description = None
    if _HAS_SELECTOLAX:
        tree = HTMLParser(html)
        t = tree.css_first("title")
        if t:
            title = (t.text() or "").strip() or None
        for sel, attr in [
            ('meta[name="description"]', "content"),
            ('meta[property="og:description"]', "content"),
        ]:
            node = tree.css_first(sel)
            if node and node.attributes.get(attr):
                description = node.attributes[attr].strip() or None
                break
    else:
        m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
        if m:
            title = re.sub(r"\s+", " ", m.group(1)).strip() or None
        m = re.search(
            r'<meta[^>]+name=["\']description["\'][^>]+content=["\'](.*?)["\']',
            html, re.I,
        )
        if m:
            description = m.group(1).strip() or None
    if title:
        title = title[:300]
    if description:
        description = description[:600]
    return {"title": title, "description": description}


def extract_emails(html: str) -> List[str]:
    emails: List[str] = []
    if _HAS_SELECTOLAX:
        tree = HTMLParser(html)
        for a in tree.css('a[href^="mailto:"]'):
            href = a.attributes.get("href") or ""
            addr = unquote(href[len("mailto:"):].split("?", 1)[0])
            cleaned = _clean_email(addr)
            if cleaned:
                emails.append(cleaned)
    # Text-body regex (catches obfuscated-but-plain emails too).
    for match in EMAIL_RE.findall(html or ""):
        cleaned = _clean_email(match)
        if cleaned:
            emails.append(cleaned)
    return _dedup_keep_order(emails)


def extract_phones(html: str) -> List[str]:
    """Return raw phone strings (validation/normalization happens in validate.py)."""
    phones: List[str] = []
    if _HAS_SELECTOLAX:
        tree = HTMLParser(html)
        for a in tree.css('a[href^="tel:"]'):
            href = a.attributes.get("href") or ""
            raw = unquote(href[len("tel:"):]).strip()
            if raw:
                phones.append(raw)
    else:
        import re
        for m in re.findall(r'href=["\']tel:([^"\']+)["\']', html or "", re.I):
            raw = unquote(m.split("?")[0]).strip()
            if raw:
                phones.append(raw)

    # If we already found tel: links, trust those and skip the noisier text
    # scan entirely — sites that bother with tel: links rarely need scraping.
    if phones:
        return _dedup_keep_order(phones)

    # Fall back to scanning visible text for phone-like sequences. To limit
    # false positives, only scan text nodes, not the whole markup, and require
    # real phone punctuation (a '+' or a separator) in the match.
    text = _visible_text(html)
    import re
    for match in PHONE_RE.findall(text):
        match = match.strip()
        if not _PHONE_SEP_RE.search(match):
            continue  # bare digit run (year range, sequence) -> reject
        if _looks_like_non_phone(match):
            continue  # year range / version / decimal -> reject
        digits = re.sub(r"\D", "", match)
        if 7 <= len(digits) <= 15:  # plausible phone length
            phones.append(match)
    return _dedup_keep_order(phones)


# Patterns that PHONE_RE can catch but are never phone numbers.
_YEAR_RANGE_RE = re.compile(r"^\s*(19|20)\d{2}\s*[-.]\s*(19|20)\d{2}\s*$")
# A "version/decimal" like 2025 99.999 or 1.2.3 — <=1 space-group and a dot,
# with no '+' and only 2-3 dot-separated numeric groups.
_VERSION_RE = re.compile(r"^\s*\d{1,4}([ .]\d{1,4}){1,3}\s*$")


def _looks_like_non_phone(match: str) -> bool:
    """Reject strings that phone-shaped regex catches but aren't phone numbers:
    copyright year ranges (2001-2026) and version/decimal strings (2025 99.999)."""
    if _YEAR_RANGE_RE.match(match):
        return True
    # If it has no '+' and no parentheses/dashes (only spaces/dots), it's very
    # likely a version or decimal, not a phone.
    if "+" not in match and "-" not in match and "(" not in match:
        if _VERSION_RE.match(match):
            return True
    return False


def extract_whatsapp(html: str) -> List[str]:
    """Extract WhatsApp numbers from wa.me / api.whatsapp.com links."""
    out: List[str] = []
    for m in re.findall(
        r'https?://(?:wa\.me|api\.whatsapp\.com/send)[^"\'\s<>]*', html or "", re.I
    ):
        digits = re.sub(r"\D", "", m.split("phone=")[-1] if "phone=" in m else m)
        # wa.me/<number>
        tail = m.rstrip("/").split("/")[-1]
        tail_digits = re.sub(r"\D", "", tail)
        num = tail_digits or digits
        if 7 <= len(num) <= 15:
            out.append(num)
    return _dedup_keep_order(out)


def extract_socials(html: str) -> Dict[str, str]:
    """Return a {platform: profile_url} map of the first good link per platform."""
    found: Dict[str, str] = {}
    hrefs: List[str] = []
    if _HAS_SELECTOLAX:
        tree = HTMLParser(html)
        hrefs = [a.attributes.get("href") for a in tree.css("a") if a.attributes.get("href")]
    else:
        hrefs = re.findall(r'href=["\']([^"\']+)["\']', html or "", re.I)

    for href in hrefs:
        if not href or not href.lower().startswith(("http://", "https://")):
            continue
        low = href.lower()
        if any(bad in low for bad in SOCIAL_IGNORE):
            continue
        host = urlparse(href).netloc.lower().lstrip("www.")
        for platform, domains in SOCIAL_HOSTS.items():
            if platform in found:
                continue
            if any(host == d or host.endswith("." + d) for d in domains):
                # Require a path (an actual profile), not just the bare domain.
                path = urlparse(href).path.strip("/")
                if path:
                    found[platform] = href.split("?")[0]
    return found


def _visible_text(html: str) -> str:
    """Crude text extraction (strip script/style) for phone scanning."""
    if not html:
        return ""
    if _HAS_SELECTOLAX:
        tree = HTMLParser(html)
        for tag in tree.css("script, style, noscript"):
            tag.decompose()
        body = tree.body or tree.root
        return body.text(separator=" ") if body else ""
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", html)
    return re.sub(r"(?s)<[^>]+>", " ", text)


def merge_page_extractions(pages_html: List[str]) -> Dict:
    """Run all extractors across every crawled page and merge the results.

    Title/description come from the FIRST page (homepage). Contact + social data
    is unioned across all pages (contact page often has the real email/phone).
    """
    emails: List[str] = []
    phones: List[str] = []
    whatsapp: List[str] = []
    socials: Dict[str, str] = {}
    title = None
    description = None

    for idx, html in enumerate(pages_html):
        if idx == 0:
            meta = extract_title_description(html)
            title, description = meta["title"], meta["description"]
        emails.extend(extract_emails(html))
        phones.extend(extract_phones(html))
        whatsapp.extend(extract_whatsapp(html))
        for k, v in extract_socials(html).items():
            socials.setdefault(k, v)

    return {
        "title": title,
        "description": description,
        "emails": _dedup_keep_order(emails),
        "phones": _dedup_keep_order(phones),
        "whatsapp": _dedup_keep_order(whatsapp),
        "socials": socials,
    }
