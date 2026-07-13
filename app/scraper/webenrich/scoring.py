"""
Rule-based lead scoring. No AI, no ML — a transparent, additive point system so
scores are explainable and tunable.

Signals (from the merged record after enrichment):
  website present ...... 15
  https website ........ 10
  valid email .......... 20
  valid phone .......... 15
  whatsapp present ......  5
  linkedin present ..... 10
  facebook present ......  5
  instagram present .....  5
  google rating >= 4.0 .. 10   (scaled by rating)
  review_count signal ... up to 15   (log-scaled)
Capped at 100, then graded A(>=80)/B(>=60)/C(>=40)/D(<40).
"""

import math
from typing import Dict, List, Optional


WEIGHTS = {
    "website": 15,
    "https": 10,
    "email": 20,
    "phone": 15,
    "whatsapp": 5,
    "linkedin": 10,
    "facebook": 5,
    "instagram": 5,
    "rating": 10,      # scaled by rating/5
    "reviews": 15,     # log-scaled
}


def _to_float(v) -> Optional[float]:
    if v is None:
        return None
    try:
        # ratings/reviews are stored as TEXT on records; strip commas etc.
        return float(str(v).replace(",", "").strip().split()[0])
    except (ValueError, IndexError):
        return None


def score_lead(signals: Dict) -> Dict:
    """Compute score + grade + per-signal breakdown from a normalized signal dict.

    Expected keys (all optional):
      website (str), https (bool), email_valid (bool), phone_valid (bool),
      whatsapp (list/bool), socials (dict), rating (str/num), review_count (str/num)
    """
    breakdown: Dict[str, int] = {}
    total = 0

    website = signals.get("website")
    if website:
        breakdown["website"] = WEIGHTS["website"]
        total += WEIGHTS["website"]
        https = signals.get("https")
        if https is None:
            https = str(website).lower().startswith("https://")
        if https:
            breakdown["https"] = WEIGHTS["https"]
            total += WEIGHTS["https"]

    if signals.get("email_valid"):
        breakdown["email"] = WEIGHTS["email"]
        total += WEIGHTS["email"]

    if signals.get("phone_valid"):
        breakdown["phone"] = WEIGHTS["phone"]
        total += WEIGHTS["phone"]

    whatsapp = signals.get("whatsapp")
    if whatsapp:
        breakdown["whatsapp"] = WEIGHTS["whatsapp"]
        total += WEIGHTS["whatsapp"]

    socials = signals.get("socials") or {}
    for key in ("linkedin", "facebook", "instagram"):
        if socials.get(key):
            breakdown[key] = WEIGHTS[key]
            total += WEIGHTS[key]

    rating = _to_float(signals.get("rating"))
    if rating and rating > 0:
        pts = int(round(WEIGHTS["rating"] * min(rating, 5.0) / 5.0))
        breakdown["rating"] = pts
        total += pts

    reviews = _to_float(signals.get("review_count"))
    if reviews and reviews > 0:
        # log10 scale: 10 reviews ~ 5pts, 100 ~ 10pts, 1000+ ~ 15pts.
        pts = int(round(min(WEIGHTS["reviews"], 5 * math.log10(reviews + 1))))
        breakdown["reviews"] = pts
        total += pts

    total = max(0, min(100, total))
    grade = "A" if total >= 80 else "B" if total >= 60 else "C" if total >= 40 else "D"
    return {"score": total, "grade": grade, "breakdown": breakdown}
