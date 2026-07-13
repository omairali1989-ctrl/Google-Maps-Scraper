"""
Validation + normalization for extracted contact data.

- Email: syntax/deliverable-format check via email-validator (no SMTP/DNS here;
  DNS/MX checks are a second-pass feature). Returns normalized lowercase form.
- Phone: parse + validate via phonenumbers, normalized to E.164 when possible.
  A region hint (from the lead's country) improves parsing of local-format
  numbers that lack a country code.

All functions degrade gracefully if the optional libs are missing.
"""

from typing import List, Optional, Tuple

try:
    from email_validator import validate_email, EmailNotValidError
    _HAS_EMAIL_VALIDATOR = True
except Exception:  # pragma: no cover
    _HAS_EMAIL_VALIDATOR = False

try:
    import phonenumbers
    _HAS_PHONENUMBERS = True
except Exception:  # pragma: no cover
    _HAS_PHONENUMBERS = False


# Map a few common country names (as stored on records.country) to ISO-3166
# alpha-2 region codes for phone parsing. Best-effort; unknowns fall through.
COUNTRY_TO_REGION = {
    "united states": "US", "usa": "US", "us": "US",
    "united kingdom": "GB", "uk": "GB", "england": "GB",
    "united arab emirates": "AE", "uae": "AE",
    "pakistan": "PK", "india": "IN", "canada": "CA", "australia": "AU",
    "germany": "DE", "france": "FR", "spain": "ES", "italy": "IT",
    "netherlands": "NL", "saudi arabia": "SA", "qatar": "QA",
    "singapore": "SG", "malaysia": "MY", "brazil": "BR", "mexico": "MX",
}


def region_for_country(country: Optional[str]) -> Optional[str]:
    if not country:
        return None
    return COUNTRY_TO_REGION.get(country.strip().lower())


def normalize_email(email: str) -> Tuple[Optional[str], bool]:
    """Return (normalized_email_or_None, is_valid_format).

    ``check_deliverability=False`` keeps this fast + offline (no MX lookup).
    """
    if not email:
        return None, False
    if not _HAS_EMAIL_VALIDATOR:
        # Minimal fallback: shape check only.
        ok = "@" in email and "." in email.split("@")[-1]
        return (email.lower() if ok else None), ok
    try:
        result = validate_email(email, check_deliverability=False)
        return result.normalized.lower(), True
    except EmailNotValidError:
        return None, False


def pick_primary_email(emails: List[str]) -> Tuple[Optional[str], Optional[bool]]:
    """Choose the best email + its validity. Prefers info@/contact@ role addresses,
    then the first that validates."""
    if not emails:
        return None, None
    preferred_prefixes = ("info@", "contact@", "hello@", "sales@", "admin@", "office@")
    ranked = sorted(
        emails,
        key=lambda e: (0 if e.lower().startswith(preferred_prefixes) else 1),
    )
    for e in ranked:
        norm, ok = normalize_email(e)
        if ok:
            return norm, True
    # None validated; return the first raw one flagged invalid.
    return emails[0], False


def normalize_phone(
    raw: str, region: Optional[str] = None
) -> Tuple[Optional[str], bool]:
    """Return (E.164_or_original, is_valid)."""
    if not raw:
        return None, False
    if not _HAS_PHONENUMBERS:
        digits = "".join(ch for ch in raw if ch.isdigit() or ch == "+")
        return (digits or None), (7 <= len(digits.lstrip("+")) <= 15)
    try:
        # If the number has no '+', use the region hint (may be None -> may fail).
        parsed = phonenumbers.parse(raw, None if raw.strip().startswith("+") else region)
        if phonenumbers.is_valid_number(parsed):
            return (
                phonenumbers.format_number(
                    parsed, phonenumbers.PhoneNumberFormat.E164
                ),
                True,
            )
        return raw, False
    except Exception:
        return raw, False


def pick_primary_phone(
    phones: List[str], region: Optional[str] = None
) -> Tuple[Optional[str], Optional[bool]]:
    """Choose the first phone that validates (normalized to E.164)."""
    if not phones:
        return None, None
    first_norm = None
    for p in phones:
        norm, ok = normalize_phone(p, region)
        if ok:
            return norm, True
        if first_norm is None:
            first_norm = norm or p
    return first_norm, False


def normalize_all_phones(
    phones: List[str], region: Optional[str] = None
) -> List[str]:
    """Normalize every phone to E.164 where valid, dropping unparseable dupes."""
    out = []
    seen = set()
    for p in phones:
        norm, ok = normalize_phone(p, region)
        val = norm if ok else p
        if val and val not in seen:
            seen.add(val)
            out.append(val)
    return out
