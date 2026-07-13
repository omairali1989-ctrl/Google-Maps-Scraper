"""
This module contain the code for backend,
that will handle scraping process
"""

import os
import re
import sqlite3
from scraper.base import Base
from scraper.scroller import Scroller
import undetected_chromedriver as uc
from settings import DRIVER_EXECUTABLE_PATH, DB_PATH
from db import get_connection
from scraper.communicator import Communicator
from scraper.common import Common


class Backend(Base):

    def __init__(
        self,
        searchquery,
        outputformat,
        healdessmode,
        job_id=None,
        enable_enrichment=False,
        enrichment_model=None,
    ):
        """
        params:

        search query: it is the value that user will enter in search query entry
        outputformat: output format of file , selected by user
        outputpath: directory path where file will be stored after scraping
        headlessmode: it's value can be 0 and 1, 0 means unchecked box and 1 means checked

        """

        self.searchquery = searchquery  # search query that user will enter

        # it is a function used as api for transfering message form this backend to frontend

        self.headlessMode = healdessmode
        self.job_id = job_id

        self.init_driver()
        self.scroller = Scroller(driver=self.driver)
        self.scroller.job_id = self.job_id
        self.enable_enrichment = enable_enrichment
        self.enrichment_model = enrichment_model
        self.scroller.enable_enrichment = enable_enrichment
        self.scroller.enrichment_model = enrichment_model
        self.init_communicator()

    def init_communicator(self):
        Communicator.set_backend_object(self)

    def init_driver(self):
        from selenium import webdriver
        from selenium.webdriver.chrome.service import Service
        
        is_docker = os.environ.get("IS_DOCKER") == "true"

        options = webdriver.ChromeOptions()
        if self.headlessMode == 1:
            options.add_argument("--headless=new")

        # Cross-platform stability flags (safe everywhere).
        options.add_argument("--disable-gpu")
        options.add_argument("--window-size=1920,1080")
        options.add_argument("--disable-extensions")
        options.add_argument("--disable-background-networking")
        options.add_argument("--disable-default-apps")
        options.add_argument("--disable-features=VizDisplayCompositor")

        # Docker/Linux-only flags. --no-sandbox and especially --single-process
        # are required for headless Chrome inside a container but are CRASH-PRONE
        # on macOS/Windows (they cause "renderer disconnected / session deleted"
        # on startup), so they must NOT be applied on a desktop OS.
        if is_docker:
            options.add_argument("--no-sandbox")
            options.add_argument("--disable-dev-shm-usage")
            options.add_argument("--single-process")

        # 'normal' (default) waits for the full load event so Google Maps' JS has
        # wired up its lazy-scroll observers before we start scrolling. 'eager'
        # returns at DOMContentLoaded and could make the feed scroll before it's
        # interactive, capping results at the first ~20-item batch.
        options.page_load_strategy = 'normal'

        # Rotate the browser user-agent per job to vary the fingerprint.
        try:
            import netpolicy

            ua = netpolicy.random_user_agent()
            options.add_argument(f"--user-agent={ua}")

            # Route the browser through a rotating proxy if configured.
            proxy_url = netpolicy.next_proxy()
            if proxy_url:
                # Chrome expects host:port (auth-in-URL proxies aren't supported
                # via --proxy-server; strip any scheme for the flag).
                clean = proxy_url.split("://", 1)[-1]
                options.add_argument(f"--proxy-server={clean}")
                Communicator.show_message(f"Using proxy: {clean}")
        except Exception as e:
            Communicator.show_message(f"Network policy (UA/proxy) skipped: {e}")

        if is_docker:
            options.binary_location = '/usr/bin/chromium'

        # Block heavy, non-essential content to cut page weight and load time.
        # 2 == block. Google Maps' business data is text/DOM, so plugins,
        # and notifications add latency without value to the scrape.
        # NOTE: Allowing images is required for modern Google Maps layout-based
        # intersection observers to load items beyond the first 20 results.
        prefs = {
            "profile.managed_default_content_settings.images": 1,  # allow images for scroll observers
            "profile.managed_default_content_settings.plugins": 2,
            "profile.managed_default_content_settings.popups": 2,
            "profile.managed_default_content_settings.notifications": 2,
            "profile.managed_default_content_settings.stylesheets": 1,  # keep CSS (layout selectors)
        }
        options.add_experimental_option("prefs", prefs)
        # NOTE: intentionally NOT using --blink-settings=imagesEnabled=false here.
        # The prefs above already skip image downloads; the blink flag additionally
        # affects layout/observers and correlated with Google Maps' lazy-loading
        # stalling at ~20 results. Muting audio is harmless.
        options.add_argument("--mute-audio")

        Communicator.show_message(
            "Wait checking for driver...\nIf you don't have webdriver in your machine it will install it"
        )

        from selenium import webdriver
        from selenium.webdriver.chrome.service import Service
        import sys

        # Build the ordered list of strategies to try. The bundled driver is
        # tried first (fast, offline), but if it fails — most commonly a
        # Chrome/ChromeDriver major-version mismatch, which shows up as
        # "session deleted / renderer disconnected" — we fall back to Selenium
        # Manager, which downloads a driver matching the installed Chrome.
        strategies = []
        if DRIVER_EXECUTABLE_PATH is not None and os.path.exists(DRIVER_EXECUTABLE_PATH):
            strategies.append(("bundled driver", DRIVER_EXECUTABLE_PATH))
        # Selenium Manager (no explicit path) auto-resolves the right driver.
        strategies.append(("auto-managed driver", None))

        last_error = None
        for label, driver_path in strategies:
            for attempt in range(2):
                try:
                    Communicator.show_message(
                        f"Starting browser via {label} (attempt {attempt + 1})..."
                    )
                    if driver_path is not None:
                        service = Service(executable_path=driver_path)
                        self.driver = webdriver.Chrome(service=service, options=options)
                    else:
                        self.driver = webdriver.Chrome(options=options)
                    last_error = None
                    break
                except Exception as e:
                    last_error = e
                    print(f"[{label}] init attempt {attempt + 1} failed: {e}", file=sys.stderr)
                    Common.smart_sleep(2)
            if getattr(self, "driver", None) is not None and last_error is None:
                Communicator.show_message(f"Browser started via {label}.")
                break

        if getattr(self, "driver", None) is None or last_error is not None:
            # Give a clear, actionable message instead of a raw stacktrace.
            Communicator.show_message(
                "Could not start Chrome. This is usually a Chrome/ChromeDriver "
                "version mismatch. Update the driver at drivers/chromedriver to "
                "match your installed Chrome, or ensure network access so a "
                "matching driver can be downloaded automatically."
            )
            raise last_error

        Communicator.show_message("Opening browser...")
        self.driver.maximize_window()
        # The parser/scroller use explicit polling loops, so a large implicit
        # wait mostly adds latency on legitimately-absent elements. 10s is a
        # safer floor that still tolerates slow first paints.
        self.driver.implicitly_wait(10)

    def mainscraping(self):
        original_query = self.searchquery

        # Split by comma or newline
        queries = []
        for q in re.split(r"[,\n]", original_query):
            stripped = q.strip()
            if stripped:
                queries.append(stripped)

        if not queries:
            queries = [original_query]

        Communicator.show_message(
            f"Found {len(queries)} queries to scrape sequentially: {', '.join(queries)}"
        )

        try:
            for idx, q in enumerate(queries):
                if Common.close_thread_is_set():
                    Communicator.show_message(
                        "Stop signal received. Stopping scraping process..."
                    )
                    break

                Communicator.show_message(
                    f"--- Starting Query {idx+1}/{len(queries)}: '{q}' ---"
                )

                # Dynamically update self.searchquery so Communicator and DataSaver use the active sub-query
                self.searchquery = q
                self.scroller.query = q

                # Check database for pending URLs for this job and query
                pending_urls = []
                if self.job_id is not None:
                    try:
                        conn = get_connection()
                        cursor = conn.cursor()
                        cursor.execute(
                            """
                            SELECT url FROM scrape_items 
                            WHERE job_id = ? AND query = ? AND status IN ('pending', 'failed')
                        """,
                            (self.job_id, q),
                        )
                        pending_urls = [row[0] for row in cursor.fetchall()]
                        conn.close()
                    except Exception as db_err:
                        Communicator.show_message(
                            f"Warning: Error fetching pending items: {db_err}"
                        )

                try:
                    if len(pending_urls) > 0:
                        # Resume! Skip scrolling!
                        Communicator.show_message(
                            f"Resuming query '{q}' from database. "
                            f"Skipping scrolling phase. Found {len(pending_urls)} pending/failed locations to scrape."
                        )
                        # Go straight to parsing
                        self.scroller.start_parsing()  # Initialize parser
                        self.scroller.parser.job_id = self.job_id
                        self.scroller.parser.query = q
                        self.scroller.parser.enable_enrichment = self.enable_enrichment
                        self.scroller.parser.enrichment_model = self.enrichment_model
                        self.scroller.parser.main(pending_urls)
                    else:
                        # Normal flow
                        querywithplus = "+".join(q.split())
                        link_of_page = (
                            f"https://www.google.com/maps/search/{querywithplus}/"
                        )

                        self.openingurl(url=link_of_page)
                        Communicator.show_message(
                            f"Opened Google Maps for query: '{q}'"
                        )
                        Common.smart_sleep(1.5)

                        # Run the scroller (which scrolls and then automatically calls start_parsing())
                        self.scroller.scroll()
                except Exception as inner_e:
                    Communicator.show_message(
                        f"Error occurred while scraping query '{q}': {str(inner_e)}"
                    )

                # Delay between queries to avoid getting rate-limited/blocked
                if idx < len(queries) - 1:
                    Communicator.show_message("Waiting 5 seconds before next query...")
                    Common.smart_sleep(5)

        except Exception as e:
            """
            Handling any unexpected outer errors.
            """
            Communicator.show_message(f"Outer error occurred: {str(e)}")

        finally:
            try:
                Communicator.show_message("Closing the driver")
                self.driver.close()
                self.driver.quit()
            except Exception:  # if browser is always closed due to error
                pass

            Communicator.end_processing()
            Communicator.show_message("Now you can start another session")
