"""
Duplicate detection across a user's records.

Layered strategy (cheap exact matches first, fuzzy last):
  1. Exact match on any strong key: website domain, normalized phone, email.
  2. Fuzzy business-name match (rapidfuzz) combined with a normalized-address
     match, to catch the same business listed twice with slight name vari/typos.

Returns the id of an existing record this one duplicates, or None. Scoped to a
single user_id so tenants never collide.
"""

import re
from typing import Dict, List, Optional

from db import get_connection

try:
    from rapidfuzz import fuzz
    _HAS_RAPIDFUZZ = True
except Exception:  # pragma: no cover
    _HAS_RAPIDFUZZ = False

NAME_MATCH_THRESHOLD = 88   # rapidfuzz token_sort_ratio 0-100
ADDR_MATCH_THRESHOLD = 80


def _norm(s: Optional[str]) -> str:
    if not s:
        return ""
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", s.lower())).strip()


def _norm_phone(s: Optional[str]) -> str:
    return re.sub(r"\D", "", s or "")


def find_duplicate(
    record: Dict, user_id: Optional[int], exclude_id: Optional[int] = None
) -> Optional[int]:
    """Return the id of an existing record that ``record`` duplicates, or None.

    ``record`` should carry: name, address, phone, web_phones(list), email,
    web_emails(list), website, web_domain.
    """
    conn = get_connection(row_factory=True)
    try:
        cur = conn.cursor()

        # Candidate pool: same user's records only (tenant isolation).
        where = ["(user_id IS ? OR user_id = ?)"]
        params: List = [user_id, user_id]
        if exclude_id is not None:
            where.append("id != ?")
            params.append(exclude_id)
        sql = (
            "SELECT id, name, address, phone, email, website, web_domain, "
            "web_phones, web_emails FROM records WHERE " + " AND ".join(where)
        )
        rows = cur.execute(sql, tuple(params)).fetchall()
        if not rows:
            return None

        target_domain = (record.get("web_domain") or "").lower()
        target_phones = set(filter(None, [_norm_phone(record.get("phone"))]))
        for p in record.get("web_phones") or []:
            target_phones.add(_norm_phone(p))
        target_phones.discard("")

        target_emails = set(filter(None, [(record.get("email") or "").lower()]))
        for e in record.get("web_emails") or []:
            if e:
                target_emails.add(e.lower())

        target_name = _norm(record.get("name"))
        target_addr = _norm(record.get("address"))

        # Pass 1: exact strong-key matches.
        for r in rows:
            if target_domain and (r["web_domain"] or "").lower() == target_domain:
                return r["id"]
            cand_phones = {_norm_phone(r["phone"])}
            for p in _split_json_list(r["web_phones"]):
                cand_phones.add(_norm_phone(p))
            cand_phones.discard("")
            if target_phones and (target_phones & cand_phones):
                return r["id"]
            cand_emails = {(r["email"] or "").lower()}
            for e in _split_json_list(r["web_emails"]):
                cand_emails.add((e or "").lower())
            cand_emails.discard("")
            if target_emails and (target_emails & cand_emails):
                return r["id"]

        # Pass 2: fuzzy name + address (only if we have a name to compare).
        if target_name and _HAS_RAPIDFUZZ:
            for r in rows:
                cand_name = _norm(r["name"])
                if not cand_name:
                    continue
                name_score = fuzz.token_sort_ratio(target_name, cand_name)
                if name_score < NAME_MATCH_THRESHOLD:
                    continue
                cand_addr = _norm(r["address"])
                if not target_addr or not cand_addr:
                    # Strong name match with one side missing address -> treat as dup.
                    if name_score >= 95:
                        return r["id"]
                    continue
                addr_score = fuzz.token_sort_ratio(target_addr, cand_addr)
                if addr_score >= ADDR_MATCH_THRESHOLD:
                    return r["id"]
        return None
    finally:
        conn.close()


def _split_json_list(val) -> List[str]:
    if not val:
        return []
    try:
        import json

        parsed = json.loads(val)
        if isinstance(parsed, list):
            return [str(x) for x in parsed]
    except Exception:
        pass
    return []
