"""
Async website crawler for enrichment.

Fetches a small, high-signal set of pages from a business website using a shared
httpx.AsyncClient (connection pooling) with tenacity-backed retries and a hard
per-site page budget. It deliberately does NOT render JS (no browser) — most
contact/social data lives in server-rendered HTML or the page <head>.

Page discovery strategy (cheap, no full crawl):
  1. Fetch the homepage.
  2. From homepage links, pick the best candidate contact / about pages by
     matching common URL/anchor patterns.
  3. Also try a few conventional paths (/contact, /about) if not linked.
Everything is bounded by MAX_PAGES so a single site can't run away.
"""

import asyncio
from typing import List, Optional, Set, Tuple
from urllib.parse import urljoin, urlparse, urldefrag

import httpx
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)

try:
    from selectolax.parser import HTMLParser
    _HAS_SELECTOLAX = True
except Exception:  # pragma: no cover - graceful fallback
    HTMLParser = None
    _HAS_SELECTOLAX = False


DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Anchors/paths that tend to hold contact + org info.
CONTACT_HINTS = ("contact", "kontakt", "reach", "get-in-touch", "connect")
ABOUT_HINTS = ("about", "team", "company", "who-we-are", "our-story")
CONVENTIONAL_PATHS = ("/contact", "/contact-us", "/about", "/about-us")

MAX_PAGES = 5          # hard per-site page budget
MAX_HTML_BYTES = 3_000_000  # skip absurdly large pages
CONNECT_TIMEOUT = 8.0
READ_TIMEOUT = 15.0


class CrawledPage:
    __slots__ = ("url", "status", "html", "final_url")

    def __init__(self, url: str, status: int, html: str, final_url: str):
        self.url = url
        self.status = status
        self.html = html
        self.final_url = final_url


def normalize_url(raw: str) -> Optional[str]:
    """Return a fetchable http(s) URL or None. Adds https:// if scheme missing."""
    if not raw:
        return None
    raw = raw.strip()
    if not raw:
        return None
    if not raw.lower().startswith(("http://", "https://")):
        raw = "https://" + raw.lstrip("/")
    parsed = urlparse(raw)
    if not parsed.netloc:
        return None
    return raw


def registrable_domain(url: str) -> Optional[str]:
    """Best-effort registrable domain (host minus leading www.).

    Not a full public-suffix parse (that needs tldextract), but sufficient for
    grouping/dedup within this app. Second pass can upgrade this.
    """
    try:
        host = urlparse(url).netloc.lower()
        if "@" in host:
            host = host.split("@", 1)[-1]
        host = host.split(":", 1)[0]
        if host.startswith("www."):
            host = host[4:]
        return host or None
    except Exception:
        return None


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=0.5, min=0.5, max=4),
    retry=retry_if_exception_type((httpx.TransportError, httpx.TimeoutException)),
)
async def _fetch(client: httpx.AsyncClient, url: str) -> Optional[CrawledPage]:
    """Fetch one URL with retry on transport/timeout errors only."""
    resp = await client.get(url)
    ctype = resp.headers.get("content-type", "")
    if "html" not in ctype and "xml" not in ctype and ctype:
        # Non-HTML (pdf/image/etc.) — record status but no body to parse.
        return CrawledPage(url, resp.status_code, "", str(resp.url))
    body = resp.text
    if len(body) > MAX_HTML_BYTES:
        body = body[:MAX_HTML_BYTES]
    return CrawledPage(url, resp.status_code, body, str(resp.url))


def _extract_links(base_url: str, html: str) -> List[str]:
    """Return same-host absolute links found in the page."""
    if not html:
        return []
    base_host = urlparse(base_url).netloc.lower().lstrip("www.")
    links: List[str] = []
    seen: Set[str] = set()

    if _HAS_SELECTOLAX:
        tree = HTMLParser(html)
        anchors = [a.attributes.get("href") for a in tree.css("a")]
    else:  # regex fallback
        import re
        anchors = re.findall(r'href=["\']([^"\']+)["\']', html, flags=re.I)

    for href in anchors:
        if not href:
            continue
        href = urldefrag(urljoin(base_url, href))[0]
        if not href.lower().startswith(("http://", "https://")):
            continue
        host = urlparse(href).netloc.lower().lstrip("www.")
        if host != base_host:
            continue  # stay on-site
        if href not in seen:
            seen.add(href)
            links.append(href)
    return links


def _rank_candidates(links: List[str]) -> Tuple[List[str], List[str]]:
    """Split same-host links into ranked contact and about candidates."""
    contact, about = [], []
    for link in links:
        low = link.lower()
        if any(h in low for h in CONTACT_HINTS):
            contact.append(link)
        elif any(h in low for h in ABOUT_HINTS):
            about.append(link)
    return contact, about


async def crawl_site(url: str, max_pages: int = MAX_PAGES) -> List[CrawledPage]:
    """Crawl up to ``max_pages`` high-signal pages of a single website.

    Returns the list of successfully fetched pages (homepage first). Raises only
    on a total failure to reach the homepage; individual sub-page failures are
    swallowed so partial data is still usable.
    """
    start = normalize_url(url)
    if not start:
        raise ValueError(f"Unfetchable URL: {url!r}")

    timeout = httpx.Timeout(READ_TIMEOUT, connect=CONNECT_TIMEOUT)
    limits = httpx.Limits(max_connections=10, max_keepalive_connections=5)
    pages: List[CrawledPage] = []

    async with httpx.AsyncClient(
        headers=DEFAULT_HEADERS,
        timeout=timeout,
        limits=limits,
        follow_redirects=True,
        verify=False,  # many small-business sites have broken/expired certs
    ) as client:
        home = await _fetch(client, start)
        if home is None:
            raise RuntimeError("Homepage returned no content")
        pages.append(home)

        if home.status >= 400 or not home.html:
            return pages  # nothing worth crawling further

        links = _extract_links(home.final_url or start, home.html)
        contact, about = _rank_candidates(links)

        # Build the fetch plan within the page budget.
        plan: List[str] = []
        for src in (contact[:2], about[:1]):
            for c in src:
                if c not in plan:
                    plan.append(c)
        # Add conventional paths not already covered.
        base = home.final_url or start
        for path in CONVENTIONAL_PATHS:
            candidate = urljoin(base, path)
            if candidate not in plan and candidate != base:
                plan.append(candidate)

        plan = plan[: max(0, max_pages - 1)]

        # Fetch the plan concurrently; ignore individual failures.
        async def _safe(u: str):
            try:
                return await _fetch(client, u)
            except Exception:
                return None

        results = await asyncio.gather(*[_safe(u) for u in plan])
        seen_finals = {home.final_url}
        for page in results:
            if page and page.html and page.final_url not in seen_finals:
                seen_finals.add(page.final_url)
                pages.append(page)

    return pages
