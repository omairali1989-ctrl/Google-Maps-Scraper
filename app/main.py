import os
import sys
import asyncio
import json
from fastapi import FastAPI, Request, Depends, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, Union
from sse_starlette.sse import EventSourceResponse

# Ensure app/ and root/ directories are in Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from web_bridge import JobManager
from settings import OUTPUT_PATH
from db import get_connection
import jobstore
import authstore
import webenrichstore

base_dir = os.path.dirname(os.path.abspath(__file__))
static_dir = os.path.join(base_dir, "web", "static")

app = FastAPI(title="Google Maps Scraper API")
app.mount("/static", StaticFiles(directory=static_dir), name="static")

bridge = JobManager()

# Ensure the auth tables exist and a first admin owns any pre-existing data.
authstore.ensure_tables()
authstore.bootstrap_admin()
# Website (non-AI) enrichment columns + tracking table.
webenrichstore.ensure_tables()

SESSION_COOKIE = "gms_session"


# --------------------------------------------------------------------------- #
# Auth dependencies
# --------------------------------------------------------------------------- #
def _client_ip(request: Request):
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


async def current_user(request: Request):
    """Resolve the authenticated user from the session cookie, or 401."""
    token = request.cookies.get(SESSION_COOKIE)
    user = await asyncio.to_thread(authstore.get_session_user, token)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


async def require_admin(user: dict = Depends(current_user)):
    if user.get("role") != authstore.ROLE_ADMIN:
        raise HTTPException(status_code=403, detail="Administrator access required")
    return user


def user_scope(user, column="user_id"):
    """Return (sql_fragment, params) restricting a query to the user's own rows.

    Admins get an always-true clause so they see everything; standard users are
    scoped to their own id (NULL-owned rows are treated as admin-only).
    """
    if user.get("role") == authstore.ROLE_ADMIN:
        return "1=1", []
    return f"{column} = ?", [user["id"]]


def job_owned_by(job_id, user):
    """Authorization check: can this user act on/read this job?"""
    if user.get("role") == authstore.ROLE_ADMIN:
        return True
    try:
        conn = get_connection()
        row = conn.execute(
            "SELECT user_id FROM scrape_jobs WHERE id = ?", (job_id,)
        ).fetchone()
        conn.close()
        return bool(row) and str(row[0]) == str(user["id"])
    except Exception:
        return False


class ScrapeRequest(BaseModel):
    query: str
    format: str = "excel"
    headless: bool = False
    job_id: str
    enable_enrichment: bool = False
    enrichment_model: str = "google/gemini-2.5-flash"
    # When true, skip businesses this user has already scraped in past jobs
    # (cross-job dedup, same-user scope). Default off for backward compatibility.
    skip_previously_scraped: bool = False


class StopRequest(BaseModel):
    job_id: str


class KeyRequest(BaseModel):
    provider: str
    api_key: str

class JobEnrichRequest(BaseModel):
    job_id: Union[int, str]
    provider: str
    model: str


@app.post("/api/scrape")
async def start_scrape(req: ScrapeRequest, user: dict = Depends(current_user)):
    query = req.query.strip()
    format_value = req.format.strip().lower()

    if not query:
        return JSONResponse(
            {"success": False, "message": "Search query is required."}, status_code=400
        )

    if format_value not in ["excel", "csv", "json"]:
        return JSONResponse(
            {"success": False, "message": "Invalid format selection."}, status_code=400
        )

    # Stamp the job with its owner (multi-tenant isolation) and the dedup flag
    # so the scraper process can read them from the DB without extra plumbing.
    def _own():
        try:
            conn = get_connection()
            # Best-effort column add for the dedup flag (idempotent).
            try:
                conn.execute(
                    "ALTER TABLE scrape_jobs ADD COLUMN skip_previously_scraped INTEGER DEFAULT 0"
                )
            except Exception:
                pass
            conn.execute(
                "UPDATE scrape_jobs SET user_id = COALESCE(user_id, ?), "
                "skip_previously_scraped = ? WHERE id = ?",
                (user["id"], 1 if req.skip_previously_scraped else 0, req.job_id),
            )
            conn.commit()
            conn.close()
        except Exception:
            pass

    await asyncio.to_thread(_own)

    success, message = bridge.start_job(
        query,
        format_value,
        req.headless,
        req.job_id,
        req.enable_enrichment,
        req.enrichment_model,
    )
    if success:
        return {"success": True, "message": message, "job_id": req.job_id}
    else:
        return JSONResponse({"success": False, "message": message}, status_code=400)


def _owned_job_ids(user):
    """Set of job_id strings this user may see (None => admin, sees all)."""
    if user.get("role") == authstore.ROLE_ADMIN:
        return None
    try:
        conn = get_connection()
        rows = conn.execute(
            "SELECT id FROM scrape_jobs WHERE user_id = ?", (user["id"],)
        ).fetchall()
        conn.close()
        return {str(r[0]) for r in rows}
    except Exception:
        return set()


@app.get("/api/status")
async def get_status(job_id: Optional[str] = None, user: dict = Depends(current_user)):
    # Backward compatibility, or used to get a one-off status
    if job_id:
        if not await asyncio.to_thread(job_owned_by, job_id, user):
            raise HTTPException(status_code=403, detail="Not your job")
        state = bridge.get_job_state(job_id)
        if not state:
            return {
                "is_running": False,
                "messages": [],
                "scraped_count": 0,
                "job_id": job_id,
            }

        db_status = await fetch_db_status(job_id)
        scraped_count = db_status.get("success_count", state.scraped_count)

        res = {
            "is_running": state.is_running,
            "messages": state.messages,
            "scraped_count": scraped_count,
            "query": state.searchQuery,
            "format": state.outputFormatValue,
            "job_id": state.job_id,
        }
        res.update(db_status)
        return res
    else:
        all_jobs = bridge.get_all_jobs_status()
        # Restrict to jobs this user owns (admins see all).
        owned = await asyncio.to_thread(_owned_job_ids, user)
        if owned is not None:
            all_jobs = {jid: v for jid, v in all_jobs.items() if jid in owned}
        if all_jobs:
            try:
                import sqlite3
                from settings import DB_PATH

                def fetch_all():
                    conn = get_connection()
                    cursor = conn.cursor()
                    cursor.execute(
                        """
                        SELECT id, current_step, total_items, processed_items, success_count, failure_count, current_query
                        FROM scrape_jobs WHERE status IN ('running', 'paused', 'stopped')
                    """
                    )
                    rows = cursor.fetchall()
                    conn.close()
                    return rows

                rows = await asyncio.to_thread(fetch_all)
                for row in rows:
                    jid = str(row[0])
                    if jid in all_jobs:
                        all_jobs[jid].update(
                            {
                                "current_step": row[1] or "idle",
                                "total_items": row[2] or 0,
                                "processed_items": row[3] or 0,
                                "success_count": row[4] or 0,
                                "failure_count": row[5] or 0,
                                "current_query": row[6] or "",
                            }
                        )
                        all_jobs[jid]["scraped_count"] = row[4] or all_jobs[jid].get(
                            "scraped_count", 0
                        )
            except Exception as e:
                print(f"Error fetching all jobs status: {e}")
        return all_jobs


async def fetch_db_status(job_id):
    def fetch():
        import sqlite3
        from settings import DB_PATH

        db_status = {}
        try:
            conn = get_connection()
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT current_step, total_items, processed_items, success_count, failure_count, current_query
                FROM scrape_jobs WHERE id = ?
            """,
                (job_id,),
            )
            row = cursor.fetchone()
            if row:
                db_status = {
                    "current_step": row[0] or "idle",
                    "total_items": row[1] or 0,
                    "processed_items": row[2] or 0,
                    "success_count": row[3] or 0,
                    "failure_count": row[4] or 0,
                    "current_query": row[5] or "",
                }
            conn.close()
        except Exception as db_err:
            print(f"Error fetching status from SQLite: {db_err}")
        return db_status

    return await asyncio.to_thread(fetch)


@app.get("/api/v2/stream")
async def stream_status(request: Request, user: dict = Depends(current_user)):
    """
    SSE Endpoint for real-time status updates of the caller's active jobs
    (admins see all).
    """
    is_admin = user.get("role") == authstore.ROLE_ADMIN

    async def event_generator():
        while True:
            if await request.is_disconnected():
                break

            all_jobs = bridge.get_all_jobs_status()
            if not is_admin:
                # Recompute each tick so newly-created jobs by this user appear.
                owned = await asyncio.to_thread(_owned_job_ids, user)
                all_jobs = {jid: v for jid, v in all_jobs.items() if jid in owned}

            try:
                import sqlite3
                from settings import DB_PATH

                def fetch_all():
                    conn = get_connection()
                    cursor = conn.cursor()
                    cursor.execute(
                        """
                        SELECT id, current_step, total_items, processed_items, success_count, failure_count, current_query
                        FROM scrape_jobs WHERE status IN ('running', 'paused', 'stopped')
                    """
                    )
                    rows = cursor.fetchall()
                    conn.close()
                    return rows

                rows = await asyncio.to_thread(fetch_all)
                for row in rows:
                    jid = str(row[0])
                    if jid in all_jobs:
                        all_jobs[jid].update(
                            {
                                "current_step": row[1] or "idle",
                                "total_items": row[2] or 0,
                                "processed_items": row[3] or 0,
                                "success_count": row[4] or 0,
                                "failure_count": row[5] or 0,
                                "current_query": row[6] or "",
                            }
                        )
                        all_jobs[jid]["scraped_count"] = row[4] or all_jobs[jid].get(
                            "scraped_count", 0
                        )
            except Exception:
                pass

            yield {"event": "message", "data": json.dumps(all_jobs)}
            await asyncio.sleep(1.0)

    return EventSourceResponse(event_generator())


@app.post("/api/stop")
async def stop_scrape(req: StopRequest, user: dict = Depends(current_user)):
    if not await asyncio.to_thread(job_owned_by, req.job_id, user):
        raise HTTPException(status_code=403, detail="Not your job")
    stopped = bridge.stop_job(req.job_id)
    if stopped:
        return {"success": True, "message": "Stop signal sent."}
    return JSONResponse(
        {"success": False, "message": "Job not running or not found."}, status_code=400
    )


@app.get("/api/files")
async def list_files(user: dict = Depends(current_user)):
    target_dir = os.path.abspath(OUTPUT_PATH)
    if not os.path.exists(target_dir):
        return []

    def _list():
        files = []
        try:
            for f in os.listdir(target_dir):
                if f.endswith((".xlsx", ".csv", ".json")) and not f.startswith("."):
                    file_path = os.path.join(target_dir, f)
                    stat = os.stat(file_path)
                    files.append(
                        {"name": f, "size": stat.st_size, "modified": stat.st_mtime}
                    )
            files.sort(key=lambda x: x["modified"], reverse=True)
        except Exception:
            pass
        return files

    return await asyncio.to_thread(_list)


@app.get("/api/download/{filename}")
async def download_file(filename: str, user: dict = Depends(current_user)):
    target_dir = os.path.abspath(OUTPUT_PATH)
    file_path = os.path.join(target_dir, filename)
    if os.path.exists(file_path):
        return FileResponse(path=file_path, filename=filename)
    return JSONResponse({"error": "File not found"}, status_code=404)


@app.get("/api/v2/keys")
async def get_keys(user: dict = Depends(current_user)):
    def _get():
        import sqlite3
        from settings import DB_PATH

        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, provider, api_key, is_active, created_at, updated_at FROM api_keys WHERE is_active = 1"
        )
        rows = cursor.fetchall()
        keys = []
        for row in rows:
            keys.append(
                {
                    "id": row[0],
                    "provider": row[1],
                    "api_key": (
                        row[2][:4] + "..." + row[2][-4:] if len(row[2]) > 8 else "***"
                    ),
                    "is_active": bool(row[3]),
                    "created_at": row[4],
                    "updated_at": row[5],
                }
            )
        conn.close()
        return keys

    try:
        keys = await asyncio.to_thread(_get)
        return keys
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/v2/keys")
async def save_key(req: KeyRequest, user: dict = Depends(current_user)):
    provider = req.provider.strip().lower()
    api_key = req.api_key.strip()

    if not provider or not api_key:
        return JSONResponse({"error": "Provider and API key required"}, status_code=400)

    def _save():
        import sqlite3
        from settings import DB_PATH

        conn = get_connection()
        cursor = conn.cursor()
        # Upsert: api_keys has UNIQUE(provider), so a plain INSERT of an
        # existing provider would raise an IntegrityError. Update in place.
        cursor.execute(
            """
            INSERT INTO api_keys (provider, api_key, is_active, created_at, updated_at)
            VALUES (?, ?, 1, datetime('now'), datetime('now'))
            ON CONFLICT(provider) DO UPDATE SET
                api_key = excluded.api_key,
                is_active = 1,
                updated_at = datetime('now')
        """,
            (provider, api_key),
        )
        conn.commit()
        conn.close()

    try:
        await asyncio.to_thread(_save)
        return {"success": True}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/v2/keys/verify")
async def verify_key(req: KeyRequest, user: dict = Depends(current_user)):
    provider = req.provider.strip().lower()
    api_key = req.api_key.strip()

    if not provider or not api_key:
        return JSONResponse({"error": "Provider and API key required"}, status_code=400)

    def _verify():
        import requests
        from scraper.enricher import LeadEnricher
        from settings import DB_PATH

        enricher = LeadEnricher(DB_PATH)
        config = enricher._get_provider_config(provider)

        if not config:
            return {"success": False, "error": f"Provider {provider} not supported."}

        try:
            if provider == "claude":
                payload = {
                    "model": "claude-3-haiku-20240307",
                    "max_tokens": 10,
                    "messages": [{"role": "user", "content": "Say 'hello'"}]
                }
                url = config["url"]
            elif provider == "gemini":
                model = "gemini-2.5-flash"
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
                payload = {
                    "contents": [{"parts":[{"text": "Say 'hello'"}]}]
                }
            else:
                model = "gpt-3.5-turbo" if provider == "openai" else ("llama3-8b-8192" if provider == "groq" else "google/gemini-2.5-flash")
                payload = {
                    "model": model,
                    "max_tokens": 10,
                    "messages": [{"role": "user", "content": "Say 'hello'"}]
                }
                url = config["url"]

            response = requests.post(url, headers=config["headers"](api_key), json=payload, timeout=10)

            if response.status_code == 200:
                return {"success": True, "message": "API key verified successfully!"}
            else:
                return {"success": False, "error": f"Verification failed with status {response.status_code}: {response.text}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    try:
        res = await asyncio.to_thread(_verify)
        if res.get("success"):
            return res
        else:
            return JSONResponse({"error": res.get("error")}, status_code=400)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)



@app.delete("/api/v2/keys/{provider}")
async def delete_key(provider: str, user: dict = Depends(current_user)):
    def _del():
        import sqlite3
        from settings import DB_PATH

        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE api_keys SET is_active = 0 WHERE provider = ?", (provider.lower(),)
        )
        conn.commit()
        conn.close()

    try:
        await asyncio.to_thread(_del)
        return {"success": True}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/v2/billing")
async def get_billing(user: dict = Depends(current_user)):
    def _bill():
        import sqlite3
        from settings import DB_PATH

        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT provider, model, SUM(prompt_tokens), SUM(completion_tokens), COUNT(*) 
            FROM enrichment_usage 
            GROUP BY provider, model
        """
        )
        rows = cursor.fetchall()
        usage = []
        for row in rows:
            usage.append(
                {
                    "provider": row[0],
                    "model": row[1],
                    "prompt_tokens": row[2],
                    "completion_tokens": row[3],
                    "total_requests": row[4],
                }
            )
        conn.close()
        return usage

    try:
        usage = await asyncio.to_thread(_bill)
        return usage
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)



@app.get("/api/v2/jobs")
async def get_all_jobs(user: dict = Depends(current_user)):
    def _fetch():
        scope, params = user_scope(user)
        conn = get_connection()
        cursor = conn.cursor()
        # Only the caller's jobs (admins see all).
        cursor.execute(
            f"SELECT id, current_query, success_count, started_at FROM scrape_jobs "
            f"WHERE {scope} ORDER BY started_at DESC",
            params,
        )
        rows = cursor.fetchall()
        jobs = []
        for row in rows:
            jobs.append({
                "id": row[0],
                "query": row[1],
                "success_count": row[2],
                "created_at": row[3]
            })
        conn.close()
        return jobs

    try:
        jobs = await asyncio.to_thread(_fetch)
        return jobs
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@app.post("/api/v2/enrich_job")
async def enrich_job_independent(req: JobEnrichRequest, user: dict = Depends(current_user)):
    job_id_str = str(req.job_id)
    if not await asyncio.to_thread(job_owned_by, job_id_str, user):
        raise HTTPException(status_code=403, detail="Not your job")
    success, message = bridge.start_independent_enrichment(job_id_str, req.provider, req.model)
    if success:
        return {"success": True, "message": message}
    else:
        return JSONResponse({"success": False, "message": message}, status_code=400)


# --------------------------------------------------------------------------- #
# Website (non-AI) lead enrichment
# --------------------------------------------------------------------------- #
class WebEnrichmentStartRequest(BaseModel):
    # Enrich a specific set of records; if omitted, enrich all of the user's
    # records that have a website and haven't been web-enriched yet.
    record_ids: Optional[list] = None
    category: Optional[str] = None
    provider: Optional[str] = "local"
    model: Optional[str] = "local"
    # Optional cap on how many records to process this run.
    limit: Optional[int] = None


class SingleEnrichRequest(BaseModel):
    provider: str = "local"
    model: str = "local"


def _count_enrichment_targets(user, record_ids, category, limit):
    """Count records that WOULD be enriched (has website, not yet enriched),
    scoped to the user, so we can size the job up front.

    Returns (count, owner_user_id, admin_all). An admin enriches EVERY record
    (admin_all=True); a standard user is scoped to their own rows.
    """
    from scraper.webenrich.orchestrator import select_target_records

    is_admin = user.get("role") == authstore.ROLE_ADMIN
    uid = None if is_admin else user["id"]
    records = select_target_records(
        uid, record_ids=record_ids, category=category, limit=limit,
        admin_all=is_admin,
    )
    return len(records), uid, is_admin


@app.post("/api/v2/enrichment/start")
async def web_enrichment_start(
    req: WebEnrichmentStartRequest, user: dict = Depends(current_user)
):
    """Kick off a website enrichment batch over the caller's records."""
    total, uid, admin_all = await asyncio.to_thread(
        _count_enrichment_targets, user, req.record_ids, req.category, req.limit
    )
    if total == 0:
        return JSONResponse(
            {
                "success": False,
                "message": "No records to enrich (none have a website, or all "
                "are already enriched).",
            },
            status_code=400,
        )

    filter_json = json.dumps(
        {
            "record_ids": req.record_ids,
            "category": req.category,
            "provider": req.provider,
            "model": req.model,
            "limit": req.limit
        }
    )
    enrichment_job_id = await asyncio.to_thread(
        webenrichstore.create_enrichment_job, uid, filter_json, total
    )
    success, message = bridge.start_web_enrichment(
        enrichment_job_id,
        uid,
        record_ids=req.record_ids,
        category=req.category,
        provider=req.provider or "local",
        model=req.model or "local",
        admin_all=admin_all,
    )
    if not success:
        await asyncio.to_thread(
            webenrichstore.update_enrichment_progress,
            enrichment_job_id,
            status="failed",
            error_message=message,
        )
        return JSONResponse(
            {"success": False, "message": message}, status_code=400
        )
    return {
        "success": True,
        "message": message,
        "enrichment_job_id": enrichment_job_id,
        "total": total,
    }


@app.post("/api/v2/records/{record_id}/enrich")
async def enrich_single_record(
    record_id: int,
    req: SingleEnrichRequest,
    user: dict = Depends(current_user)
):
    """Enrich a single lead in real-time, returning the updated record."""
    from settings import DB_PATH

    # 1. Fetch record and verify ownership
    def _fetch_rec():
        scope, params = user_scope(user)
        conn = get_connection(row_factory=True)
        row = conn.execute(
            f"SELECT id, name, website, country, rating, total_reviews FROM records WHERE id = ? AND ({scope})",
            [record_id] + params
        ).fetchone()
        conn.close()
        return dict(row) if row else None

    rec = await asyncio.to_thread(_fetch_rec)
    if not rec:
        raise HTTPException(status_code=404, detail="Record not found")

    website = rec.get("website")
    if not website or not website.strip():
        raise HTTPException(status_code=400, detail="Record has no website URL to enrich")

    # 2. Crawl website
    from scraper.webenrich.crawler import crawl_site, normalize_url
    try:
        norm_url = normalize_url(website)
        pages = await crawl_site(norm_url, max_pages=3)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to crawl website: {e}")

    if not pages:
        raise HTTPException(status_code=400, detail="Website could not be crawled (no content returned)")

    # 3. Extract HTML & Text
    from scraper.enricher import LeadEnricher

    # Concatenate HTML content of all crawled pages
    all_html = "\n".join(p.html for p in pages if p.html)
    
    enricher = LeadEnricher(DB_PATH)
    
    try:
        enriched_info = await asyncio.to_thread(
            enricher.enrich_lead,
            all_html,
            rec["name"],
            req.provider,
            req.model
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Enrichment process failed: {e}")

    if not enriched_info:
        raise HTTPException(status_code=500, detail="Enrichment process returned empty data")

    # 4. Save back to database
    def _save_enriched():
        conn = get_connection()
        
        emails_list = [e.strip() for e in enriched_info.get("emails", "").split(",") if e.strip()] if enriched_info.get("emails") else []
        phones_list = [p.strip() for p in enriched_info.get("phones", "").split(",") if p.strip()] if enriched_info.get("phones") else []
        whatsapp_list = [w.strip() for w in enriched_info.get("whatsapp", "").split(",") if w.strip()] if enriched_info.get("whatsapp") else []
        
        # socials mapping
        socials_map = {}
        if enriched_info.get("social_profiles"):
            for p in enriched_info["social_profiles"].split(","):
                p = p.strip()
                if "facebook.com" in p: socials_map["facebook"] = p
                elif "instagram.com" in p: socials_map["instagram"] = p
                elif "linkedin.com" in p: socials_map["linkedin"] = p
                elif "twitter.com" in p or "x.com" in p: socials_map["twitter"] = p
                elif "youtube.com" in p: socials_map["youtube"] = p
                elif "tiktok.com" in p: socials_map["tiktok"] = p
        
        email_primary = enriched_info.get("email_primary") or (emails_list[0] if emails_list else None)
        phone_primary = enriched_info.get("phone_primary") or (phones_list[0] if phones_list else None)
        
        email_valid = 1 if email_primary else 0
        phone_valid = 1 if phone_primary else 0
        
        lead_score = enriched_info.get("lead_score") or 0
        lead_grade = "A" if lead_score >= 80 else "B" if lead_score >= 60 else "C" if lead_score >= 40 else "D"
        
        conn.execute(
            """
            UPDATE records SET
                email = COALESCE(email, ?),
                phone = COALESCE(phone, ?),
                enriched_company_info = ?,
                social_profiles = ?,
                owner_name = ?,
                ceo_name = ?,
                coo_name = ?,
                executives = ?,
                linkedin_url = ?,
                is_enriched = 1,
                
                web_emails = ?,
                web_phones = ?,
                web_whatsapp = ?,
                web_socials = ?,
                web_title = ?,
                web_description = ?,
                web_tech = ?,
                email_valid = ?,
                phone_valid = ?,
                lead_score = ?,
                lead_grade = ?,
                web_enriched = 1,
                web_enriched_at = datetime('now'),
                updated_at = datetime('now')
            WHERE id = ?
            """,
            (
                email_primary,
                phone_primary,
                enriched_info.get("enriched_company_info"),
                enriched_info.get("social_profiles"),
                enriched_info.get("owner_name"),
                enriched_info.get("ceo_name"),
                enriched_info.get("coo_name"),
                enriched_info.get("executives"),
                enriched_info.get("linkedin_url"),
                
                json.dumps(emails_list),
                json.dumps(phones_list),
                json.dumps(whatsapp_list),
                json.dumps(socials_map),
                enriched_info.get("website_title"),
                enriched_info.get("website_description"),
                json.dumps(enriched_info.get("technologies", "").split(",") if enriched_info.get("technologies") else []),
                email_valid,
                phone_valid,
                lead_score,
                lead_grade,
                record_id
            )
        )
        conn.commit()
        
        updated_row = conn.execute("SELECT * FROM records WHERE id = ?", [record_id]).fetchone()
        conn.close()
        return dict(updated_row) if updated_row else None

    updated_record = await asyncio.to_thread(_save_enriched)
    return {"success": True, "record": updated_record}


@app.get("/api/v2/enrichment/status")
async def web_enrichment_status(
    enrichment_job_id: Optional[int] = None, user: dict = Depends(current_user)
):
    """Return a single enrichment job's progress, or the caller's recent jobs."""
    is_admin = user.get("role") == authstore.ROLE_ADMIN

    def _fetch():
        conn = get_connection(row_factory=True)
        try:
            if enrichment_job_id is not None:
                row = conn.execute(
                    "SELECT * FROM web_enrichment_jobs WHERE id = ?",
                    (enrichment_job_id,),
                ).fetchone()
                if not row:
                    return None
                job = dict(row)
                # Authorization: owner or admin only.
                if not is_admin and job.get("user_id") not in (None, user["id"]):
                    return "forbidden"
                return job
            # List recent jobs scoped to the user.
            if is_admin:
                rows = conn.execute(
                    "SELECT * FROM web_enrichment_jobs ORDER BY id DESC LIMIT 25"
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM web_enrichment_jobs "
                    "WHERE user_id = ? OR user_id IS NULL ORDER BY id DESC LIMIT 25",
                    (user["id"],),
                ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    result = await asyncio.to_thread(_fetch)
    if result == "forbidden":
        raise HTTPException(status_code=403, detail="Not your enrichment job")
    if result is None:
        raise HTTPException(status_code=404, detail="Enrichment job not found")
    return result


@app.post("/api/v2/enrichment/retry")
async def web_enrichment_retry(
    req: WebEnrichmentStartRequest, user: dict = Depends(current_user)
):
    """Re-run enrichment for records that previously failed (web_enrich_error set
    and not yet successfully enriched). Same selection logic; resume is implicit
    because only un-enriched records are picked up."""
    # Retry simply starts a fresh batch — select_target_records already skips
    # records with web_enriched=1, so failures/unfinished ones are retried.
    return await web_enrichment_start(req, user)


@app.get("/api/v2/enrichment/export")
async def web_enrichment_export(
    format: str = "csv", user: dict = Depends(current_user)
):
    """Export the caller's enriched records (all enriched fields) as CSV or JSON."""
    scope, params = user_scope(user, "user_id")

    def _fetch():
        conn = get_connection(row_factory=True)
        try:
            rows = conn.execute(
                f"""
                SELECT id, name, category, phone, email, website, address,
                       city, region, country, rating, total_reviews,
                       web_domain, web_title, web_description,
                       web_emails, web_phones, web_whatsapp, web_socials,
                       email_valid, phone_valid, lead_score, lead_grade,
                       duplicate_of, web_http_status, web_pages_crawled,
                       web_enriched, web_enriched_at
                FROM records
                WHERE ({scope}) AND COALESCE(web_enriched, 0) = 1
                ORDER BY COALESCE(lead_score, -1) DESC, id DESC
                """,
                params,
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    records = await asyncio.to_thread(_fetch)

    if format == "json":
        return JSONResponse(records)

    # CSV
    import csv
    import io

    if not records:
        return JSONResponse({"error": "No enriched records to export"}, status_code=404)
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(records[0].keys()))
    writer.writeheader()
    writer.writerows(records)
    from fastapi.responses import Response

    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=enriched_leads.csv"
        },
    )


# --------------------------------------------------------------------------- #
# Observability: logs, retries, analytics, alerts
# --------------------------------------------------------------------------- #
@app.get("/api/v2/jobs/{job_id}/logs")
async def get_job_logs(job_id: str, limit: int = 500, user: dict = Depends(current_user)):
    if not await asyncio.to_thread(job_owned_by, job_id, user):
        raise HTTPException(status_code=403, detail="Not your job")

    def _fetch():
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT level, message, created_at FROM job_logs "
            "WHERE job_id = ? ORDER BY id DESC LIMIT ?",
            (job_id, limit),
        )
        rows = cur.fetchall()
        conn.close()
        return [
            {"level": r[0], "message": r[1], "created_at": r[2]}
            for r in reversed(rows)
        ]

    try:
        return await asyncio.to_thread(_fetch)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/v2/jobs/{job_id}/retries")
async def get_job_retries(job_id: str, user: dict = Depends(current_user)):
    if not await asyncio.to_thread(job_owned_by, job_id, user):
        raise HTTPException(status_code=403, detail="Not your job")

    def _fetch():
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT url, attempt, reason, created_at FROM job_retries "
            "WHERE job_id = ? ORDER BY id DESC",
            (job_id,),
        )
        rows = cur.fetchall()
        conn.close()
        return [
            {"url": r[0], "attempt": r[1], "reason": r[2], "created_at": r[3]}
            for r in rows
        ]

    try:
        return await asyncio.to_thread(_fetch)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/v2/analytics")
async def get_analytics(user: dict = Depends(current_user)):
    """Aggregate execution metrics for the caller's jobs (admins: all jobs)."""

    def _fetch():
        scope, params = user_scope(user)
        conn = get_connection()
        cur = conn.cursor()

        # Status breakdown (includes Queued now)
        cur.execute(
            f"SELECT status, COUNT(*) FROM scrape_jobs WHERE {scope} GROUP BY status",
            params,
        )
        by_status = {row[0]: row[1] for row in cur.fetchall()}

        # Totals + success rate
        cur.execute(
            f"SELECT COALESCE(SUM(success_count),0), COALESCE(SUM(failure_count),0), "
            f"COUNT(*) FROM scrape_jobs WHERE {scope}",
            params,
        )
        total_success, total_failure, total_jobs = cur.fetchone()
        processed = (total_success or 0) + (total_failure or 0)
        success_rate = (total_success / processed * 100) if processed else 0.0

        # Average execution time (seconds) for finished jobs
        cur.execute(
            f"SELECT AVG(julianday(completed_at) - julianday(started_at)) * 86400.0 "
            f"FROM scrape_jobs WHERE {scope} AND completed_at IS NOT NULL AND started_at IS NOT NULL",
            params,
        )
        avg_seconds = cur.fetchone()[0] or 0.0

        # Per-job execution metrics (recent 20)
        cur.execute(
            f"SELECT id, query, status, success_count, failure_count, "
            f"total_items, started_at, completed_at, "
            f"(julianday(COALESCE(completed_at, datetime('now'))) - julianday(started_at)) * 86400.0 AS duration_s "
            f"FROM scrape_jobs WHERE {scope} ORDER BY started_at DESC LIMIT 20",
            params,
        )
        cols = [c[0] for c in cur.description]
        recent = [dict(zip(cols, row)) for row in cur.fetchall()]

        conn.close()
        return {
            "by_status": by_status,
            "queued": bridge.get_queued_count(),
            "running": bridge.get_running_count(),
            "total_jobs": total_jobs or 0,
            "total_records": total_success or 0,
            "total_failures": total_failure or 0,
            "success_rate": round(success_rate, 1),
            "avg_execution_seconds": round(avg_seconds, 1),
            "recent_jobs": recent,
        }

    try:
        return await asyncio.to_thread(_fetch)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/v2/alerts")
async def get_alerts(
    unread_only: bool = False, limit: int = 50, user: dict = Depends(current_user)
):
    def _fetch():
        conn = get_connection()
        cur = conn.cursor()
        clauses = []
        params = []
        if unread_only:
            clauses.append("a.is_read = 0")
        # Scope alerts to the user's own jobs (admins see all). Alerts not tied
        # to a job (system alerts) are admin-only.
        if user.get("role") != authstore.ROLE_ADMIN:
            clauses.append("j.user_id = ?")
            params.append(user["id"])
        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        params.append(limit)
        cur.execute(
            f"SELECT a.id, a.job_id, a.severity, a.title, a.detail, a.is_read, a.created_at "
            f"FROM alerts a LEFT JOIN scrape_jobs j ON a.job_id = CAST(j.id AS TEXT) "
            f"{where} ORDER BY a.id DESC LIMIT ?",
            params,
        )
        rows = cur.fetchall()
        conn.close()
        return [
            {
                "id": r[0],
                "job_id": r[1],
                "severity": r[2],
                "title": r[3],
                "detail": r[4],
                "is_read": bool(r[5]),
                "created_at": r[6],
            }
            for r in rows
        ]

    try:
        return await asyncio.to_thread(_fetch)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


class AlertReadRequest(BaseModel):
    alert_id: Optional[int] = None  # None => mark all read


@app.post("/api/v2/alerts/read")
async def mark_alert_read(req: AlertReadRequest, user: dict = Depends(current_user)):
    def _update():
        conn = get_connection()
        cur = conn.cursor()
        if req.alert_id is None:
            cur.execute("UPDATE alerts SET is_read = 1")
        else:
            cur.execute("UPDATE alerts SET is_read = 1 WHERE id = ?", (req.alert_id,))
        conn.commit()
        conn.close()

    try:
        await asyncio.to_thread(_update)
        return {"success": True}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# --------------------------------------------------------------------------- #
# Network policy: proxies, user-agent rotation, rate limiting
# --------------------------------------------------------------------------- #
class NetConfigRequest(BaseModel):
    ua_rotation_enabled: Optional[bool] = None
    rate_limit_seconds: Optional[float] = None


class ProxyRequest(BaseModel):
    url: str


@app.get("/api/v2/netpolicy")
async def get_netpolicy(admin: dict = Depends(require_admin)):
    def _fetch():
        import netpolicy

        netpolicy.ensure_tables()
        return {
            "ua_rotation_enabled": netpolicy.rotation_enabled(),
            "rate_limit_seconds": netpolicy.rate_limit_delay(),
            "proxies": _list_proxies(),
        }

    try:
        return await asyncio.to_thread(_fetch)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


def _list_proxies():
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, url, is_active, fail_count, last_used_at FROM proxies ORDER BY id"
    ).fetchall()
    conn.close()
    return [
        {
            "id": r[0],
            "url": r[1],
            "is_active": bool(r[2]),
            "fail_count": r[3],
            "last_used_at": r[4],
        }
        for r in rows
    ]


@app.post("/api/v2/netpolicy")
async def update_netpolicy(req: NetConfigRequest, admin: dict = Depends(require_admin)):
    def _update():
        import netpolicy

        netpolicy.ensure_tables()
        if req.ua_rotation_enabled is not None:
            netpolicy.set_config("ua_rotation_enabled", "1" if req.ua_rotation_enabled else "0")
        if req.rate_limit_seconds is not None:
            netpolicy.set_config("rate_limit_seconds", max(0.0, req.rate_limit_seconds))
        return {"success": True}

    try:
        return await asyncio.to_thread(_update)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/v2/netpolicy/proxies")
async def add_proxy(req: ProxyRequest, admin: dict = Depends(require_admin)):
    url = req.url.strip()
    if not url:
        return JSONResponse({"error": "Proxy URL required"}, status_code=400)

    def _add():
        import netpolicy

        netpolicy.ensure_tables()
        conn = get_connection()
        conn.execute(
            "INSERT INTO proxies (url, is_active) VALUES (?, 1) "
            "ON CONFLICT(url) DO UPDATE SET is_active = 1, fail_count = 0",
            (url,),
        )
        conn.commit()
        conn.close()
        return {"success": True}

    try:
        return await asyncio.to_thread(_add)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.delete("/api/v2/netpolicy/proxies/{proxy_id}")
async def delete_proxy(proxy_id: int, admin: dict = Depends(require_admin)):
    def _del():
        conn = get_connection()
        conn.execute("DELETE FROM proxies WHERE id = ?", (proxy_id,))
        conn.commit()
        conn.close()
        return {"success": True}

    try:
        return await asyncio.to_thread(_del)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# --------------------------------------------------------------------------- #
# Scheduling
# --------------------------------------------------------------------------- #
class ScheduleRequest(BaseModel):
    query: str
    run_at: str  # ISO/SQL datetime in UTC, e.g. "2026-07-10 09:00:00"
    interval_minutes: int = 0
    format: str = "excel"
    headless: bool = True
    enable_enrichment: bool = False
    enrichment_model: Optional[str] = None


@app.get("/api/v2/schedules")
async def get_schedules(user: dict = Depends(current_user)):
    def _fetch():
        import scheduler

        scheduler.ensure_tables()
        all_scheds = scheduler.list_schedules()
        if user.get("role") == authstore.ROLE_ADMIN:
            return all_scheds
        return [s for s in all_scheds if s.get("user_id") == user["id"]]

    try:
        return await asyncio.to_thread(_fetch)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/v2/schedules")
async def create_schedule_endpoint(req: ScheduleRequest, user: dict = Depends(current_user)):
    if not req.query.strip():
        return JSONResponse({"error": "Query required"}, status_code=400)

    def _create():
        import scheduler

        scheduler.ensure_tables()
        sched_id = scheduler.create_schedule(
            req.query.strip(),
            req.run_at,
            interval_minutes=req.interval_minutes,
            format_value=req.format,
            headless=req.headless,
            enable_enrichment=req.enable_enrichment,
            enrichment_model=req.enrichment_model,
            user_id=user["id"],
        )
        return {"success": True, "id": sched_id}

    try:
        return await asyncio.to_thread(_create)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.delete("/api/v2/schedules/{sched_id}")
async def delete_schedule_endpoint(sched_id: int, user: dict = Depends(current_user)):
    def _del():
        import scheduler

        # Ownership check: non-admins can only delete their own schedules.
        if user.get("role") != authstore.ROLE_ADMIN:
            owner = scheduler.schedule_owner(sched_id)
            if owner != user["id"]:
                return None
        return {"success": scheduler.delete_schedule(sched_id)}

    try:
        result = await asyncio.to_thread(_del)
        if result is None:
            return JSONResponse({"error": "Not your schedule"}, status_code=403)
        return result
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# --------------------------------------------------------------------------- #
# Authentication
# --------------------------------------------------------------------------- #
class LoginRequest(BaseModel):
    username: str
    password: str
    remember: bool = False


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@app.post("/api/v2/auth/login")
async def login(req: LoginRequest, request: Request):
    ip = _client_ip(request)
    ua = request.headers.get("user-agent")
    user, err = await asyncio.to_thread(
        authstore.authenticate, req.username.strip(), req.password
    )
    if err:
        await asyncio.to_thread(
            authstore.audit, "failed_login", None, ip, f"username={req.username}"
        )
        msg = {
            "invalid_credentials": "Invalid username or password.",
            "account_disabled": "This account is disabled.",
            "account_locked": "Account locked due to failed attempts. Try again later.",
        }.get(err, "Login failed.")
        return JSONResponse({"success": False, "error": msg}, status_code=401)

    token = await asyncio.to_thread(
        authstore.create_session, user["id"], ip, ua, req.remember
    )
    await asyncio.to_thread(authstore.audit, "login", user, ip)
    resp = JSONResponse({"success": True, "user": user})
    max_age = (
        authstore.REMEMBER_TTL_DAYS if req.remember else authstore.SESSION_TTL_DAYS
    ) * 86400
    resp.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=max_age,
        httponly=True,
        samesite="lax",
        path="/",
    )
    return resp


@app.post("/api/v2/auth/logout")
async def logout(request: Request):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        await asyncio.to_thread(authstore.destroy_session, token)
    resp = JSONResponse({"success": True})
    resp.delete_cookie(SESSION_COOKIE, path="/")
    return resp


@app.get("/api/v2/auth/me")
async def whoami(user: dict = Depends(current_user)):
    return {"success": True, "user": user}


@app.post("/api/v2/auth/change-password")
async def change_password(
    req: ChangePasswordRequest, request: Request, user: dict = Depends(current_user)
):
    row = await asyncio.to_thread(authstore.get_user_by_username, user["username"])
    if not row or not authstore.verify_password(req.current_password, row[3]):
        return JSONResponse(
            {"success": False, "error": "Current password is incorrect."},
            status_code=400,
        )
    if len(req.new_password) < 6:
        return JSONResponse(
            {"success": False, "error": "New password must be at least 6 characters."},
            status_code=400,
        )
    await asyncio.to_thread(authstore.set_password, user["id"], req.new_password)
    await asyncio.to_thread(
        authstore.audit, "change_password", user, _client_ip(request)
    )
    return {"success": True}


# --------------------------------------------------------------------------- #
# User management (admin only)
# --------------------------------------------------------------------------- #
class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str = "user"
    email: Optional[str] = None


@app.get("/api/v2/users")
async def list_users_endpoint(admin: dict = Depends(require_admin)):
    return await asyncio.to_thread(authstore.list_users)


@app.post("/api/v2/users")
async def create_user_endpoint(
    req: CreateUserRequest, request: Request, admin: dict = Depends(require_admin)
):
    if not req.username.strip() or len(req.password) < 6:
        return JSONResponse(
            {"error": "Username and a 6+ char password are required."}, status_code=400
        )
    try:
        uid = await asyncio.to_thread(
            authstore.create_user,
            req.username.strip(),
            req.password,
            req.role,
            req.email,
        )
        await asyncio.to_thread(
            authstore.audit, "user_create", admin, _client_ip(request),
            f"user={req.username}", None, f"role={req.role}"
        )
        return {"success": True, "id": uid}
    except Exception:
        return JSONResponse(
            {"error": "Could not create user (username may already exist)."},
            status_code=400,
        )


@app.delete("/api/v2/users/{user_id}")
async def delete_user_endpoint(
    user_id: int, request: Request, admin: dict = Depends(require_admin)
):
    if user_id == admin["id"]:
        return JSONResponse(
            {"error": "You cannot delete your own account."}, status_code=400
        )
    await asyncio.to_thread(authstore.delete_user, user_id)
    await asyncio.to_thread(
        authstore.audit, "user_delete", admin, _client_ip(request), f"user_id={user_id}"
    )
    return {"success": True}


class UpdateUserRequest(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None
    new_password: Optional[str] = None


@app.patch("/api/v2/users/{user_id}")
async def update_user_endpoint(
    user_id: int, req: UpdateUserRequest, request: Request,
    admin: dict = Depends(require_admin)
):
    if req.role is not None:
        await asyncio.to_thread(authstore.set_role, user_id, req.role)
    if req.is_active is not None:
        await asyncio.to_thread(authstore.set_active, user_id, req.is_active)
    if req.new_password:
        await asyncio.to_thread(authstore.set_password, user_id, req.new_password)
    await asyncio.to_thread(
        authstore.audit, "user_update", admin, _client_ip(request), f"user_id={user_id}"
    )
    return {"success": True}


@app.get("/api/v2/audit")
async def get_audit(limit: int = 100, admin: dict = Depends(require_admin)):
    return await asyncio.to_thread(authstore.list_audit, limit)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=5001, reload=False)
