"""
Shared data-normalization helpers for scraped business records.

These functions were previously duplicated verbatim in parser.py and
datasaver.py. They are the single source of truth for the dedup key, coordinate
extraction, and address parsing so all write paths agree on record identity.
"""

from __future__ import annotations

import hashlib
import re
from typing import Optional, Tuple


def compute_dedup_hash(
    name: Optional[str], address: Optional[str] = None, phone: Optional[str] = None
) -> str:
    """Stable identity hash for a business (name + address + phone).

    Used as the UNIQUE key on the records table so the same business scraped
    twice upserts instead of duplicating.
    """
    normalized_name = (name or "").lower().strip()
    normalized_address = (address or "").lower().strip()
    normalized_phone = (phone or "").strip()
    raw_string = f"{normalized_name}|{normalized_address}|{normalized_phone}"
    return hashlib.md5(raw_string.encode("utf-8")).hexdigest()


def extract_coordinates(
    url: Optional[str],
) -> Tuple[Optional[float], Optional[float]]:
    """Pull (lat, lng) out of a Google Maps place URL, or (None, None)."""
    if not url:
        return None, None
    match1 = re.search(r"@(-?\d+\.\d+),(-?\d+\.\d+)", url)
    if match1:
        return float(match1.group(1)), float(match1.group(2))
    match2 = re.search(r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)", url)
    if match2:
        return float(match2.group(1)), float(match2.group(2))
    return None, None


def parse_address(
    address: Optional[str],
) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """Best-effort split of a free-form address into (country, city, region)."""
    if not address:
        return None, None, None
    parts = [p.strip() for p in re.split(r",|\s+-\s+", address) if p.strip()]
    if not parts:
        return None, None, None

    country: Optional[str] = None
    city: Optional[str] = None
    region: Optional[str] = None

    last_part = parts[-1]
    country = re.sub(r"\d+", "", last_part).strip()

    if not country and len(parts) > 1:
        country = re.sub(r"\d+", "", parts[-2]).strip()

    if len(parts) > 1:
        second_last = parts[-2]
        words = [w for w in second_last.split() if w]
        if len(words) == 2 and len(words[0]) == 2 and re.match(r"^[A-Z]{2}$", words[0]):
            region = words[0]
        else:
            region = re.sub(r"\d+", "", second_last).strip()

    if len(parts) > 2:
        city = re.sub(r"\d+", "", parts[-3]).strip()
    elif len(parts) == 2:
        city = re.sub(r"\d+", "", parts[0]).strip()

    return country or None, city or region or None, region or None


def is_valid_record(item: dict) -> bool:
    """Minimal validation before a record is written to the DB.

    A record must at least have a non-empty name; everything else is optional.
    """
    if not isinstance(item, dict):
        return False
    name = item.get("Name") or item.get("name")
    return bool(name and str(name).strip())


def filter_previously_scraped(job_id, urls: list) -> Tuple[list, int]:
    """Drop URLs already collected by the job owner in earlier jobs.

    Cross-job dedup with SAME-USER scope: returns (urls_to_scrape, skipped_count).
    Only applies when the job's ``skip_previously_scraped`` flag is set; otherwise
    returns the input unchanged. Never raises — dedup is best-effort.
    """
    if not urls:
        return urls, 0
    try:
        from db import get_connection

        conn = get_connection()
        cur = conn.cursor()
        row = cur.execute(
            "SELECT user_id, COALESCE(skip_previously_scraped, 0) "
            "FROM scrape_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
        if not row or not row[1]:
            conn.close()
            return urls, 0
        user_id = row[0]

        # URLs this user already has as completed records.
        seen = set()
        if user_id is not None:
            existing = cur.execute(
                "SELECT google_maps_url FROM records "
                "WHERE user_id = ? AND google_maps_url IS NOT NULL",
                (user_id,),
            ).fetchall()
            seen = {r[0] for r in existing}
        conn.close()

        if not seen:
            return urls, 0
        kept = [u for u in urls if u not in seen]
        return kept, len(urls) - len(kept)
    except Exception:
        return urls, 0
