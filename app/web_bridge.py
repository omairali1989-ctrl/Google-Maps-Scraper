import threading
import time
import multiprocessing

# Ensure app/ is importable for the module-level db helper used by the main process.
import sys as _sys
import os as _os
_sys.path.append(_os.path.dirname(_os.path.abspath(__file__)))
from db import get_connection
import jobstore


def run_scraper_process(
    query,
    format_value,
    headless,
    queue,
    stop_event,
    job_id=None,
    enable_enrichment=False,
    enrichment_model=None,
):
    import sys
    import os

    # Ensure app/ and root/ directories are in Python path for child process imports
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    from scraper.communicator import Communicator
    from scraper.scraper import Backend
    from scraper.common import Common

    # Map Common's close check to the multiprocessing.Event
    Common.close_thread_is_set = stop_event.is_set

    class ChildProcessBridge:
        def __init__(self, format_val, q):
            self.format_val = format_val
            self.q = q

        def messageshowing(self, message):
            self.q.put(("message", message))

        def end_processing(self):
            self.q.put(("end", None))

        @property
        def outputFormatValue(self):
            return self.format_val

    bridge_obj = ChildProcessBridge(format_value, queue)
    Communicator.set_frontend_object(bridge_obj)

    try:
        backend = Backend(
            query,
            format_value,
            healdessmode=headless,
            job_id=job_id,
            enable_enrichment=enable_enrichment,
            enrichment_model=enrichment_model,
        )
        backend.mainscraping()
    except Exception as e:
        queue.put(("message", f"WebBridge Exception: {str(e)}"))
        # Persist a failure state + alert so the dashboard reflects the crash.
        try:
            import jobstore

            jobstore.set_job_status(job_id, "failed", current_step="failed")
            jobstore.add_alert(
                f"Scrape job {job_id} failed",
                detail=str(e),
                severity="error",
                job_id=job_id,
            )
        except Exception:
            pass
    finally:
        queue.put(("end", None))



def run_independent_enrich_process(job_id, provider, model, queue):
    import sys
    import os
    import sqlite3
    import requests
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    from scraper.communicator import Communicator
    from scraper.enricher import LeadEnricher
    from scraper.datasaver import DataSaver
    from settings import DB_PATH

    class IndependentBridge:
        def __init__(self, q):
            self.q = q
        def messageshowing(self, message):
            self.q.put(("message", message))
        def end_processing(self):
            self.q.put(("end", None))

    bridge_obj = IndependentBridge(queue)
    Communicator.set_frontend_object(bridge_obj)

    try:
        Communicator.show_message(f"Starting Independent Enrichment for job {job_id} using {provider} ({model})...")
        
        # Connect to DB and fetch pending records
        conn = get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        query = '''
            SELECT r.name, r.website, r.dedup_hash 
            FROM records r
            JOIN scrape_items si ON r.google_maps_url = si.url
            WHERE si.job_id = ? AND r.is_enriched != 1 AND r.website IS NOT NULL AND r.website != ''
        '''
        cursor.execute(query, (job_id,))
        records_to_enrich = cursor.fetchall()
        conn.close()

        total = len(records_to_enrich)
        if total == 0:
            Communicator.show_message("No unenriched records with websites found for this job.")
            queue.put(("end", None))
            return

        Communicator.show_message(f"Found {total} records to enrich.")
        
        enricher = LeadEnricher(DB_PATH)
        
        enriched_count = 0
        for idx, row in enumerate(records_to_enrich):
            name = row['name']
            website = row['website']
            dedup_hash = row['dedup_hash']
            
            Communicator.show_message(f"[{idx+1}/{total}] Fetching website for {name}...")
            
            html_content = None
            try:
                import netpolicy

                res = netpolicy.get(website, timeout=10)
                if res.status_code == 200:
                    html_content = res.text
            except Exception as e:
                Communicator.show_message(f"Failed to fetch website {website}: {e}")
            
            if html_content:
                enriched_info = enricher.enrich_lead(html_content, name, provider, model)
                if enriched_info:
                    # Update DB
                    conn = get_connection()
                    cursor = conn.cursor()
                    cursor.execute('''
                        UPDATE records SET
                            enriched_company_info = ?,
                            social_profiles = ?,
                            owner_name = ?,
                            ceo_name = ?,
                            coo_name = ?,
                            executives = ?,
                            linkedin_url = ?,
                            is_enriched = 1,
                            updated_at = datetime('now')
                        WHERE dedup_hash = ?
                    ''', (
                        enriched_info.get("enriched_company_info"),
                        enriched_info.get("social_profiles"),
                        enriched_info.get("owner_name"),
                        enriched_info.get("ceo_name"),
                        enriched_info.get("coo_name"),
                        enriched_info.get("executives"),
                        enriched_info.get("linkedin_url"),
                        dedup_hash
                    ))
                    conn.commit()
                    conn.close()
                    enriched_count += 1
                    Communicator.show_message(f"Successfully enriched {name}.")
                else:
                    Communicator.show_message(f"Failed to extract info for {name}.")
            else:
                Communicator.show_message(f"Skipping {name} due to missing HTML content.")
        
        Communicator.show_message(f"Enrichment complete! Enriched {enriched_count}/{total} records.")
        
        # We optionally could regenerate the Excel file here using datasaver
        ds = DataSaver()
        # Find query name and format
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT current_query FROM scrape_jobs WHERE id = ?", (job_id,))
        job_row = cursor.fetchone()
        conn.close()
        
        if job_row:
            query_name = job_row[0]
            Communicator.show_message("Regenerating final Excel output...")
            ds.save_job_output(job_id, "excel", query_name)
            
    except Exception as e:
        queue.put(("message", f"Independent Enrichment Exception: {str(e)}"))
    finally:
        queue.put(("end", None))


def run_web_enrichment_process(
    enrichment_job_id, user_id, record_ids, category, provider, model,
    queue, stop_event, admin_all=False
):
    """Process target for a WEBSITE (non-AI) enrichment batch.

    Runs the async orchestrator, streaming progress lines back over ``queue``
    (the same message/end protocol used by scraping jobs) so the existing
    JobState monitor + logging just work.
    """
    import sys
    import os

    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    def emit(msg):
        try:
            queue.put(("message", msg))
        except Exception:
            pass

    try:
        import webenrichstore
        from settings import DB_PATH
        from scraper.webenrich.orchestrator import run_enrichment_batch

        webenrichstore.ensure_tables()
        stop_check = stop_event.is_set if stop_event is not None else None
        counters = run_enrichment_batch(
            user_id=user_id,
            record_ids=record_ids or None,
            category=category or None,
            provider=provider or "local",
            model=model or "local",
            db_path=DB_PATH,
            enrichment_job_id=enrichment_job_id,
            stop_check=stop_check,
            progress_cb=emit,
            admin_all=admin_all,
        )
        emit(
            f"Total records saved: {counters.get('succeeded', 0)}. "
            f"Website enrichment finished "
            f"({counters.get('succeeded', 0)} ok / {counters.get('failed', 0)} failed)."
        )
    except Exception as e:
        emit(f"Website Enrichment Exception: {str(e)}")
        try:
            import webenrichstore

            webenrichstore.update_enrichment_progress(
                enrichment_job_id, status="failed", error_message=str(e)
            )
        except Exception:
            pass
    finally:
        queue.put(("end", None))


class JobState:
    def __init__(self, job_id, query, format_value, headless):
        self.job_id = job_id
        self.searchQuery = query
        self.outputFormatValue = format_value
        self.headlessMode = headless
        self.process = None
        self.queue = None
        self.stop_event = None
        self.is_running = False
        self.messages = []
        self.scraped_count = 0
        self.accumulated_records = 0
        self.current_query_scrolled = 0
        self.monitor_thread = None
        # Called by the manager when the job process ends, so the queue can
        # dispatch the next waiting job into the freed slot.
        self.on_finish = None

    def _classify_level(self, message):
        low = message.lower()
        if any(k in low for k in ("exception", "error", "crash", "failed", "could not")):
            return "error"
        if any(k in low for k in ("warning", "retry", "timeout", "falling back")):
            return "warning"
        return "info"

    def messageshowing(self, message):
        print(f"[Scraper Web Log Job {self.job_id}]: {message}")
        self.messages.append(message)
        # Keep the in-memory tail bounded to avoid unbounded growth on long jobs.
        if len(self.messages) > 500:
            self.messages = self.messages[-500:]
        # Persist a timestamped, leveled log line (durable across restarts).
        try:
            jobstore.add_log(self.job_id, message, level=self._classify_level(message))
        except Exception:
            pass

        # Check if we can parse location count from message
        if "Total locations scrolled:" in message:
            try:
                parts = message.split(":")
                if len(parts) > 1:
                    self.current_query_scrolled = int(parts[1].strip())
                    self.scraped_count = (
                        self.accumulated_records + self.current_query_scrolled
                    )
            except Exception:
                pass
        elif "Total records saved:" in message:
            try:
                # E.g. "Total records saved: X. If you're loving..."
                parts = message.split("Total records saved:")
                if len(parts) > 1:
                    sub_parts = parts[1].strip().split(".")
                    count = int(sub_parts[0].strip())
                    self.accumulated_records += count
                    self.scraped_count = self.accumulated_records
                    self.current_query_scrolled = 0
            except Exception:
                pass

    def stop_job(self):
        if self.is_running:
            self.messages.append("Stop request sent to scraper process...")
            if self.stop_event:
                self.stop_event.set()

            # Update SQLite job status to stopped (paused)
            if self.job_id is not None:
                try:
                    import sqlite3
                    from settings import DB_PATH

                    conn = get_connection()
                    cursor = conn.cursor()
                    cursor.execute(
                        """
                        UPDATE scrape_jobs
                        SET status = 'stopped', current_step = 'stopped', completed_at = datetime('now')
                        WHERE id = ?
                    """,
                        (self.job_id,),
                    )
                    conn.commit()
                    conn.close()
                except Exception as db_err:
                    print(f"Error marking job as stopped in DB: {db_err}")

            # Start a daemon thread to monitor and force-terminate if it does not exit in 5 seconds
            def force_terminate():
                time.sleep(5)
                if self.is_running and self.process and self.process.is_alive():
                    self.messageshowing(
                        "Scraper did not stop gracefully. Force terminating process..."
                    )
                    try:
                        self.process.terminate()
                        self.process.join()
                    except Exception as e:
                        print(f"Error terminating process: {e}")
                    self.is_running = False

            t = threading.Thread(target=force_terminate)
            t.daemon = True
            t.start()
            return True
        return False

    def _monitor_queue(self):
        try:
            while self.is_running:
                try:
                    val = self.queue.get(timeout=0.5)
                    msg_type, data = val
                    if msg_type == "message":
                        self.messageshowing(data)
                    elif msg_type == "end":
                        self.is_running = False
                        break
                except Exception:
                    if self.process and not self.process.is_alive():
                        self.is_running = False
                        break
        finally:
            self.is_running = False
            # Free the slot and let the queue dispatch the next job.
            if self.on_finish:
                try:
                    self.on_finish(self.job_id)
                except Exception:
                    pass


class JobManager:
    """
    Manages scraper job processes with a durable, concurrency-limited queue.

    When the running slots are full, new jobs are enqueued (status 'queued' in
    SQLite) instead of being rejected. A background dispatcher thread launches
    queued jobs as slots free up, so submitting many jobs "just works" and they
    drain at the configured concurrency.

    Concurrency is capped by CHROME_MAX_CONCURRENT. Each job runs a full Chrome
    (~300-700MB), so the cap is clamped to a host-safe ceiling; true horizontal
    scale to hundreds of tasks requires a distributed worker fleet (see README).
    """

    # Hard ceiling to protect a single host from OOM regardless of config.
    MAX_CONCURRENCY_CEILING = 16

    def __init__(self):
        import os

        self.active_jobs = {}
        self._lock = threading.RLock()
        # (payload) tuples waiting for a free slot, kept in-memory but mirrored
        # to SQLite (status='queued') so the queue survives inspection/restart.
        self._pending = []  # list of dicts describing queued scrape jobs

        requested = int(os.environ.get("CHROME_MAX_CONCURRENT", "3"))
        self.max_concurrent_jobs = max(1, min(requested, self.MAX_CONCURRENCY_CEILING))

        jobstore.ensure_tables()
        try:
            import netpolicy
            import scheduler

            netpolicy.ensure_tables()
            scheduler.ensure_tables()
        except Exception:
            pass
        self._recover_orphaned_jobs()

        # Background dispatcher fills freed slots from the queue.
        self._dispatcher = threading.Thread(target=self._dispatch_loop, daemon=True)
        self._dispatcher.start()

        # Background scheduler fires due one-time / recurring schedules.
        self._scheduler_thread = threading.Thread(
            target=self._schedule_loop, daemon=True
        )
        self._scheduler_thread.start()

    # ------------------------------------------------------------------ #
    # Recovery
    # ------------------------------------------------------------------ #
    def _recover_orphaned_jobs(self):
        """On startup, any job left 'running' from a previous process is dead.

        Re-queue jobs that were 'queued' before the restart and mark stale
        'running' jobs as 'stopped' so the UI reflects reality.
        """
        try:
            conn = get_connection(row_factory=True)
            cur = conn.cursor()
            cur.execute(
                "UPDATE scrape_jobs SET status='stopped', current_step='stopped', "
                "completed_at=datetime('now') WHERE status='running'"
            )
            cur.execute(
                "SELECT id, query, format, headless, enable_enrichment, enrichment_model "
                "FROM scrape_jobs WHERE status='queued' ORDER BY priority DESC, queued_at ASC"
            )
            rows = cur.fetchall()
            conn.commit()
            conn.close()
            for r in rows:
                self._pending.append(
                    {
                        "job_id": str(r["id"]),
                        "query": r["query"],
                        "format_value": r["format"] or "excel",
                        "headless": bool(r["headless"]),
                        "enable_enrichment": bool(r["enable_enrichment"]),
                        "enrichment_model": r["enrichment_model"],
                        "kind": "scrape",
                    }
                )
        except Exception as e:
            print(f"Job recovery skipped: {e}")

    # ------------------------------------------------------------------ #
    # Introspection
    # ------------------------------------------------------------------ #
    def get_running_count(self):
        return sum(1 for job in self.active_jobs.values() if job.is_running)

    def get_queued_count(self):
        with self._lock:
            return len(self._pending)

    def get_job_state(self, job_id):
        return self.active_jobs.get(job_id)

    # ------------------------------------------------------------------ #
    # Submission (enqueues if slots are full)
    # ------------------------------------------------------------------ #
    def start_job(
        self,
        query,
        format_value,
        headless,
        job_id=None,
        enable_enrichment=False,
        enrichment_model=None,
    ):
        if job_id is None:
            return False, "Job ID is required to start a multi-process job."

        with self._lock:
            if job_id in self.active_jobs and self.active_jobs[job_id].is_running:
                return False, f"Scraping job {job_id} is already running."

            payload = {
                "job_id": job_id,
                "query": query,
                "format_value": format_value,
                "headless": headless,
                "enable_enrichment": enable_enrichment,
                "enrichment_model": enrichment_model,
                "kind": "scrape",
            }

            if self.get_running_count() >= self.max_concurrent_jobs:
                self._pending.append(payload)
                position = len(self._pending)
                jobstore.set_job_status(job_id, "queued", current_step="queued")
                self._mark_queued_at(job_id)
                jobstore.add_log(
                    job_id,
                    f"Job queued (position {position}). Running "
                    f"{self.get_running_count()}/{self.max_concurrent_jobs} slots.",
                    level="info",
                )
                return True, f"Job queued at position {position}."

            self._launch(payload)
            return True, "Scraping job started successfully."

    def start_independent_enrichment(self, job_id, provider, model):
        with self._lock:
            if job_id in self.active_jobs and self.active_jobs[job_id].is_running:
                return False, f"Job {job_id} is already running."

            payload = {
                "job_id": job_id,
                "provider": provider,
                "model": model,
                "kind": "enrich",
            }

            if self.get_running_count() >= self.max_concurrent_jobs:
                self._pending.append(payload)
                jobstore.add_log(
                    job_id,
                    f"Enrichment queued (position {len(self._pending)}).",
                    level="info",
                )
                return True, f"Enrichment queued at position {len(self._pending)}."

            self._launch(payload)
            return True, "Independent enrichment started successfully."

    def start_web_enrichment(self, enrichment_job_id, user_id, record_ids=None, category=None, provider="local", model="local", admin_all=False):
        """Queue/launch a WEBSITE (non-AI) enrichment batch.

        ``enrichment_job_id`` is a row in web_enrichment_jobs. We key the queue
        by a namespaced id so it coexists with scrape jobs without colliding.
        ``admin_all`` lets an administrator enrich every record, not just their own.
        """
        job_key = f"webenrich:{enrichment_job_id}"
        with self._lock:
            if job_key in self.active_jobs and self.active_jobs[job_key].is_running:
                return False, f"Website enrichment {enrichment_job_id} already running."

            payload = {
                "job_id": job_key,
                "enrichment_job_id": enrichment_job_id,
                "user_id": user_id,
                "record_ids": record_ids,
                "category": category,
                "provider": provider,
                "model": model,
                "admin_all": admin_all,
                "kind": "web_enrich",
            }

            if self.get_running_count() >= self.max_concurrent_jobs:
                self._pending.append(payload)
                return True, f"Website enrichment queued at position {len(self._pending)}."

            self._launch(payload)
            return True, "Website enrichment started successfully."

    # ------------------------------------------------------------------ #
    # Launch / dispatch
    # ------------------------------------------------------------------ #
    def _launch(self, payload):
        """Start a job process immediately. Caller must hold self._lock."""
        job_id = payload["job_id"]
        kind = payload.get("kind", "scrape")

        if kind == "web_enrich":
            job_state = JobState(job_id, "Website Enrichment", "none", False)
            job_state.messages = [
                f"Initializing website enrichment (job {payload['enrichment_job_id']})..."
            ]
            target = run_web_enrichment_process
            # (enrichment_job_id, user_id, record_ids, category, provider,
            #  model, queue, stop_event, admin_all)
            args = (
                payload["enrichment_job_id"],
                payload.get("user_id"),
                payload.get("record_ids"),
                payload.get("category"),
                payload.get("provider", "local"),
                payload.get("model", "local"),
                None,
                None,
                payload.get("admin_all", False),
            )
        elif kind == "enrich":
            job_state = JobState(job_id, "Independent Enrichment", "excel", False)
            job_state.messages = [
                f"Initializing Independent Enrichment for job {job_id}..."
            ]
            target = run_independent_enrich_process
            args = (job_id, payload["provider"], payload["model"], None)
        else:
            job_state = JobState(
                job_id, payload["query"], payload["format_value"], payload["headless"]
            )
            job_state.messages = ["Initializing scraper..."]
            target = run_scraper_process
            args = (
                payload["query"],
                payload["format_value"],
                payload["headless"],
                None,
                None,
                job_id,
                payload["enable_enrichment"],
                payload["enrichment_model"],
            )

        job_state.is_running = True
        job_state.queue = multiprocessing.Queue()
        job_state.stop_event = multiprocessing.Event()
        job_state.on_finish = self._on_job_finished

        # Wire the freshly-created queue/stop_event into the process args.
        args = list(args)
        if kind == "enrich":
            args[3] = job_state.queue
        elif kind == "web_enrich":
            args[6] = job_state.queue
            args[7] = job_state.stop_event
        else:
            args[3] = job_state.queue
            args[4] = job_state.stop_event
        job_state.process = multiprocessing.Process(target=target, args=tuple(args))
        job_state.process.start()

        job_state.monitor_thread = threading.Thread(target=job_state._monitor_queue)
        job_state.monitor_thread.daemon = True
        job_state.monitor_thread.start()

        self.active_jobs[job_id] = job_state
        # web_enrich tracks progress in its own web_enrichment_jobs table, so it
        # must NOT touch scrape_jobs status (its job_id isn't a scrape_jobs row).
        if kind != "web_enrich":
            jobstore.set_job_status(job_id, "running", current_step="idle")

    def _on_job_finished(self, job_id):
        """Callback from a job's monitor thread when its process exits."""
        # Finalize job status if the scraper didn't already set a terminal state.
        try:
            conn = get_connection(row_factory=True)
            cur = conn.cursor()
            row = cur.execute(
                "SELECT status, success_count FROM scrape_jobs WHERE id = ?", (job_id,)
            ).fetchone()
            if row and row["status"] == "running":
                cur.execute(
                    "UPDATE scrape_jobs SET status='completed', current_step='completed', "
                    "completed_at=datetime('now') WHERE id = ?",
                    (job_id,),
                )
                conn.commit()
            conn.close()
        except Exception:
            pass
        # A slot just freed; wake the dispatcher.
        self._try_dispatch()

    def _dispatch_loop(self):
        while True:
            self._try_dispatch()
            time.sleep(1.0)

    def _schedule_loop(self):
        """Poll for due schedules; create + enqueue a real job for each."""
        import scheduler

        while True:
            try:
                for sched in scheduler.due_schedules():
                    job_id = scheduler.create_job_row(sched)
                    scheduler.advance_schedule(sched)
                    ok, msg = self.start_job(
                        sched["query"],
                        sched.get("format", "excel"),
                        bool(sched.get("headless", 1)),
                        job_id=job_id,
                        enable_enrichment=bool(sched.get("enable_enrichment", 0)),
                        enrichment_model=sched.get("enrichment_model"),
                    )
                    jobstore.add_log(
                        job_id,
                        f"Scheduled run fired (schedule #{sched['id']}): {msg}",
                        level="info",
                    )
            except Exception as e:
                print(f"Scheduler loop error: {e}")
            time.sleep(30.0)  # check twice a minute

    def _try_dispatch(self):
        with self._lock:
            while self._pending and self.get_running_count() < self.max_concurrent_jobs:
                payload = self._pending.pop(0)
                try:
                    self._launch(payload)
                except Exception as e:
                    jobstore.add_log(
                        payload.get("job_id"),
                        f"Failed to launch queued job: {e}",
                        level="error",
                    )
                    jobstore.add_alert(
                        "Job failed to launch",
                        detail=str(e),
                        severity="error",
                        job_id=payload.get("job_id"),
                    )

    def _mark_queued_at(self, job_id):
        try:
            conn = get_connection()
            conn.execute(
                "UPDATE scrape_jobs SET queued_at = datetime('now') WHERE id = ?",
                (job_id,),
            )
            conn.commit()
            conn.close()
        except Exception:
            pass

    # ------------------------------------------------------------------ #
    # Control
    # ------------------------------------------------------------------ #
    def stop_job(self, job_id):
        with self._lock:
            # If it's only queued, remove it from the queue.
            for i, p in enumerate(self._pending):
                if p["job_id"] == job_id:
                    self._pending.pop(i)
                    jobstore.set_job_status(job_id, "stopped", current_step="stopped")
                    jobstore.add_log(job_id, "Queued job cancelled.", level="info")
                    return True
        job_state = self.get_job_state(job_id)
        if job_state:
            return job_state.stop_job()
        return False

    def get_all_jobs_status(self):
        status_dict = {}
        for jid, state in list(self.active_jobs.items()):
            status_dict[jid] = {
                "is_running": state.is_running,
                "messages": state.messages,
                "scraped_count": state.scraped_count,
                "query": state.searchQuery,
                "format": state.outputFormatValue,
            }
        # Surface queued jobs too, so the dashboard shows a Queued state.
        with self._lock:
            for pos, p in enumerate(self._pending, start=1):
                status_dict[p["job_id"]] = {
                    "is_running": False,
                    "is_queued": True,
                    "queue_position": pos,
                    "messages": [f"Queued (position {pos})"],
                    "scraped_count": 0,
                    "query": p.get("query", "Independent Enrichment"),
                    "format": p.get("format_value", "excel"),
                    "current_step": "queued",
                }
        return status_dict
