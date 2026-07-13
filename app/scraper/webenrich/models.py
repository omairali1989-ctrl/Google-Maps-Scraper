"""Typed result container for a single website enrichment.

Uses a dataclass (3.9-compatible) rather than Pydantic here because these
objects live entirely inside the worker process and are serialized to plain
dicts before crossing the process/DB boundary. The API layer (main.py) uses
Pydantic for request/response models.
"""

from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional


@dataclass
class EnrichmentResult:
    url: str
    domain: Optional[str] = None
    final_url: Optional[str] = None
    http_status: Optional[int] = None
    pages_crawled: int = 0

    title: Optional[str] = None
    description: Optional[str] = None

    emails: List[str] = field(default_factory=list)
    phones: List[str] = field(default_factory=list)
    whatsapp: List[str] = field(default_factory=list)
    socials: Dict[str, str] = field(default_factory=dict)

    # Validation
    email_valid: Optional[bool] = None
    phone_valid: Optional[bool] = None

    # AI / Extended fields
    owner_name: Optional[str] = None
    ceo_name: Optional[str] = None
    coo_name: Optional[str] = None
    executives: Optional[str] = None
    linkedin_url: Optional[str] = None
    enriched_company_info: Optional[str] = None

    # Scoring (filled by scoring.py against the merged record)
    lead_score: Optional[int] = None
    lead_grade: Optional[str] = None

    ok: bool = False
    error: Optional[str] = None

    def to_dict(self) -> Dict:
        return asdict(self)
