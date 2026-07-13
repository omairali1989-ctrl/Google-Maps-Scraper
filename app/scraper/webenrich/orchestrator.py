"""
Batch enrichment orchestrator.

Pulls a set of records (by explicit ids or a filter), runs them through the
per-site `enrich_website` pipeline with a bounded async worker pool, and
persists results back to the `records` table + updates `web_enrichment_jobs`
progress. Also performs duplicate detection against the user's other records.

Concurrency is bounded by an asyncio.Semaphore (independent of the Chrome job
concurrency — these are lightweight HTTP fetches, so more parallelism is fine).
Interrupted jobs resume naturally: only records with web_enriched != 1 are
selected, so re-running an enrichment job picks up where it left off.
"""

import asyncio
import json
from typing import Callable, Dict, List, Optional

from db import get_connection, execute_with_retry
import webenrichstore
from .pipeline import enrich_website
from . import dedup

DEFAULT_CONCURRENCY = 8


def _log(cb: Optional[Callable], msg: str):
    if cb:
        try:
            cb(msg)
        except Exception:
            pass


def select_target_records(
    user_id: Optional[int],
    record_ids: Optional[List[int]] = None,
    category: Optional[str] = None,
    only_unenriched: bool = True,
    require_website: bool = True,
    limit: Optional[int] = None,
    admin_all: bool = False,
) -> List[Dict]:
    """Return records (as dicts) to enrich, scoped to a user.

    ``admin_all=True`` bypasses tenant scoping so an administrator can enrich
    every record (including those owned by other users and NULL-owned rows).
    """
    conn = get_connection(row_factory=True)
    try:
        where = []
        params: List = []
        if not admin_all:
            # Tenant scope: the user's own rows, plus NULL-owned (backfilled) rows.
            where.append("(user_id IS ? OR user_id = ?)")
            params.extend([user_id, user_id])
        if record_ids:
            placeholders = ",".join("?" for _ in record_ids)
            where.append(f"id IN ({placeholders})")
            params.extend(record_ids)
        if category:
            where.append("category = ?")
            params.append(category)
        if require_website:
            where.append("website IS NOT NULL AND TRIM(website) != ''")
        if only_unenriched:
            where.append("COALESCE(web_enriched, 0) != 1")
        sql = (
            "SELECT id, name, address, phone, email, website, country, "
            "rating, total_reviews, user_id, web_phones, web_emails, web_domain "
            "FROM records WHERE " + " AND ".join(where) + " ORDER BY id"
        )
        if limit:
            sql += f" LIMIT {int(limit)}"
        rows = conn.execute(sql, tuple(params)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _persist_record(record_id: int, result, user_id: Optional[int]) -> None:
    """Write one enrichment result back to its record + set duplicate_of."""
    emails_json = json.dumps(result.emails or [])
    phones_json = json.dumps(result.phones or [])
    whatsapp_json = json.dumps(result.whatsapp or [])
    socials_json = json.dumps(result.socials or {})

    # Duplicate detection uses the freshly-enriched data.
    dup_id = None
    try:
        dup_id = dedup.find_duplicate(
            {
                "name": _record_field(record_id, "name"),
                "address": _record_field(record_id, "address"),
                "phone": _record_field(record_id, "phone"),
                "email": _record_field(record_id, "email"),
                "website": result.url,
                "web_domain": result.domain,
                "web_phones": result.phones,
                "web_emails": result.emails,
            },
            user_id=user_id,
            exclude_id=record_id,
        )
    except Exception:
        dup_id = None

    owner_name = getattr(result, "owner_name", None)
    ceo_name = getattr(result, "ceo_name", None)
    coo_name = getattr(result, "coo_name", None)
    executives = getattr(result, "executives", None)
    linkedin_url = getattr(result, "linkedin_url", None)
    enriched_company_info = getattr(result, "enriched_company_info", None)
    social_profiles = ",".join(result.socials.values()) if (result.socials and isinstance(result.socials, dict)) else None

    def _write():
        conn = get_connection()
        conn.execute(
            """
            UPDATE records SET
                web_emails = ?, web_phones = ?, web_whatsapp = ?, web_socials = ?,
                web_title = ?, web_description = ?, web_domain = ?,
                web_http_status = ?, web_pages_crawled = ?,
                email_valid = ?, phone_valid = ?,
                lead_score = ?, lead_grade = ?, duplicate_of = ?,
                web_enriched = 1, web_enriched_at = datetime('now'),
                web_enrich_error = ?, updated_at = datetime('now'),
                
                enriched_company_info = ?,
                social_profiles = ?,
                owner_name = ?,
                ceo_name = ?,
                coo_name = ?,
                executives = ?,
                linkedin_url = ?,
                is_enriched = 1
            WHERE id = ?
            """,
            (
                emails_json, phones_json, whatsapp_json, socials_json,
                result.title, result.description, result.domain,
                result.http_status, result.pages_crawled,
                _as_int(result.email_valid), _as_int(result.phone_valid),
                result.lead_score, result.lead_grade, dup_id,
                None if result.ok else (result.error or "enrichment failed"),
                
                enriched_company_info,
                social_profiles,
                owner_name,
                ceo_name,
                coo_name,
                executives,
                linkedin_url,
                
                record_id,
            ),
        )
        conn.commit()
        conn.close()

    execute_with_retry(_write)


def _mark_failed(record_id: int, error: str) -> None:
    def _write():
        conn = get_connection()
        conn.execute(
            "UPDATE records SET web_enrich_error = ?, updated_at = datetime('now') "
            "WHERE id = ?",
            (error[:500], record_id),
        )
        conn.commit()
        conn.close()

    try:
        execute_with_retry(_write)
    except Exception:
        pass


_FIELD_CACHE: Dict[int, Dict] = {}


def _prime_field_cache(records: List[Dict]) -> None:
    for r in records:
        _FIELD_CACHE[r["id"]] = r


def _record_field(record_id: int, field: str):
    return (_FIELD_CACHE.get(record_id) or {}).get(field)


def _as_int(v) -> Optional[int]:
    if v is None:
        return None
    return 1 if v else 0


async def _run_async(
    records: List[Dict],
    enrichment_job_id: Optional[int],
    concurrency: int,
    stop_check: Optional[Callable[[], bool]],
    progress_cb: Optional[Callable[[str], None]],
    provider: str = "local",
    model: str = "local",
    db_path: Optional[str] = None,
) -> Dict:
    sem = asyncio.Semaphore(concurrency)
    counters = {"processed": 0, "succeeded": 0, "failed": 0}
    total = len(records)
    lock = asyncio.Lock()

    async def _worker(rec: Dict):
        if stop_check and stop_check():
            return
        async with sem:
            if stop_check and stop_check():
                return
            rid = rec["id"]
            try:
                result = await enrich_website(
                    rec.get("website"),
                    country=rec.get("country"),
                    rating=rec.get("rating"),
                    review_count=rec.get("total_reviews"),
                    provider=provider,
                    model=model,
                    company_name=rec.get("name"),
                    db_path=db_path,
                )
                # run blocking DB write in a thread to keep the loop free
                await asyncio.to_thread(_persist_record, rid, result, rec.get("user_id"))
                async with lock:
                    counters["processed"] += 1
                    if result.ok:
                        counters["succeeded"] += 1
                    else:
                        counters["failed"] += 1
                status = "OK" if result.ok else f"ERR ({result.error})"
                _log(
                    progress_cb,
                    f"[{counters['processed']}/{total}] {rec.get('name') or rid}: "
                    f"{status} score={result.lead_score} "
                    f"emails={len(result.emails)} phones={len(result.phones)}",
                )
            except Exception as e:
                await asyncio.to_thread(_mark_failed, rid, str(e))
                async with lock:
                    counters["processed"] += 1
                    counters["failed"] += 1
                _log(progress_cb, f"[{counters['processed']}/{total}] {rid}: FATAL {e}")

            if enrichment_job_id is not None and counters["processed"] % 5 == 0:
                webenrichstore.update_enrichment_progress(
                    enrichment_job_id,
                    processed=counters["processed"],
                    succeeded=counters["succeeded"],
                    failed=counters["failed"],
                )

    await asyncio.gather(*[_worker(r) for r in records])
    return counters


def run_enrichment_batch(
    user_id: Optional[int],
    record_ids: Optional[List[int]] = None,
    category: Optional[str] = None,
    provider: str = "local",
    model: str = "local",
    db_path: Optional[str] = None,
    enrichment_job_id: Optional[int] = None,
    concurrency: int = DEFAULT_CONCURRENCY,
    stop_check: Optional[Callable[[], bool]] = None,
    progress_cb: Optional[Callable[[str], None]] = None,
    limit: Optional[int] = None,
    admin_all: bool = False,
) -> Dict:
    """Synchronous entry point (drives its own event loop). Returns final counters.

    Safe to call from a multiprocessing.Process target.
    """
    records = select_target_records(
        user_id, record_ids=record_ids, category=category, limit=limit,
        admin_all=admin_all,
    )
    _prime_field_cache(records)
    total = len(records)
    _log(progress_cb, f"Website enrichment: {total} record(s) selected.")

    if enrichment_job_id is not None:
        webenrichstore.update_enrichment_progress(
            enrichment_job_id, status="running"
        )

    if total == 0:
        if enrichment_job_id is not None:
            webenrichstore.update_enrichment_progress(
                enrichment_job_id, status="completed", processed=0
            )
        return {"processed": 0, "succeeded": 0, "failed": 0, "total": 0}

    counters = asyncio.run(
        _run_async(
            records,
            enrichment_job_id,
            concurrency,
            stop_check,
            progress_cb,
            provider=provider,
            model=model,
            db_path=db_path,
        )
    )
    counters["total"] = total

    if enrichment_job_id is not None:
        stopped = bool(stop_check and stop_check())
        webenrichstore.update_enrichment_progress(
            enrichment_job_id,
            processed=counters["processed"],
            succeeded=counters["succeeded"],
            failed=counters["failed"],
            status="stopped" if stopped else "completed",
        )
    _log(
        progress_cb,
        f"Website enrichment complete: {counters['succeeded']} ok, "
        f"{counters['failed']} failed of {total}.",
    )
    return counters
