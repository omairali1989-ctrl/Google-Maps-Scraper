import time
import sqlite3
from settings import DB_PATH
from db import get_connection
from scraper.communicator import Communicator
from scraper.common import Common
from selenium.common.exceptions import JavascriptException
from scraper.parser import Parser


class Scroller:

    def __init__(self, driver) -> None:
        self.driver = driver
        self.job_id = None
        self.query = None
        self.enable_enrichment = False
        self.enrichment_model = None

    def __init_parser(self):
        self.parser = Parser(self.driver)

    def start_parsing(self):
        self.__init_parser()  # init parser object on fly
        self.parser.job_id = self.job_id
        self.parser.query = self.query
        self.parser.enable_enrichment = getattr(self, "enable_enrichment", False)
        self.parser.enrichment_model = getattr(self, "enrichment_model", None)
        self.parser.main(self.__allResultsLinks)

    def scroll(self):
        """In case search results are not available"""
        self.__allResultsLinks = []
        self.__seen_links = set()

        # Wait up to 10 seconds for the scrollable feed to load
        scrollAbleElement = None
        for _ in range(10):
            scrollAbleElement = self.driver.execute_script(
                """return document.querySelector("[role='feed']")"""
            )
            if scrollAbleElement is not None:
                break
            Common.smart_sleep(1)

        if scrollAbleElement is None:
            Communicator.show_message(
                message="We are sorry but, No results found for your search query on googel maps...."
            )

        else:
            Communicator.show_message(message="Starting scrolling")

            # Google Maps lazy-loads results in batches of ~20 as you scroll the
            # feed. The old loop stopped after 5 stagnant iterations (~5s), which
            # frequently fired right after the first batch -> capped at ~20.
            #
            # This loop instead tracks the RESULT COUNT (not just scrollHeight)
            # and only stops when the count is stable across many patient checks
            # or the explicit "end of list" marker appears. It also extracts
            # links every iteration (some batches append without growing height).
            MAX_STAGNANT_ROUNDS = 12   # ~12s of no new results before giving up
            MAX_TOTAL_ROUNDS = 600     # hard safety cap (~10 min of scrolling)

            stagnant_rounds = 0
            total_rounds = 0

            while True:
                if Common.close_thread_is_set():
                    self.driver.quit()
                    return

                total_rounds += 1
                if total_rounds > MAX_TOTAL_ROUNDS:
                    break

                prev_count = len(self.__allResultsLinks)

                # Scroll the feed to the bottom to trigger lazy-loading. Nudge the
                # last card into view too, which reliably kicks the observer.
                try:
                    self.driver.execute_script(
                        """
                        var el = document.querySelector("[role='feed']");
                        if (el) { el.scrollTo(0, el.scrollHeight); }
                        var cards = document.getElementsByClassName('hfpxzc');
                        if (cards.length) { cards[cards.length - 1].scrollIntoView(false); }
                        """
                    )
                except JavascriptException:
                    pass

                Common.smart_sleep(1.2)

                # Extract every result link currently in the DOM (dedup by set).
                current_links = self.driver.execute_script(
                    "return Array.from(document.querySelectorAll('a.hfpxzc')).map(a => a.href);"
                ) or []
                new_links = [
                    link
                    for link in current_links
                    if link and link not in self.__seen_links
                ]

                if new_links:
                    self.__seen_links.update(new_links)
                    self.__allResultsLinks.extend(new_links)
                    Communicator.show_message(
                        f"Total locations scrolled: {len(self.__allResultsLinks)}"
                    )
                    self._persist_links(new_links)

                # Decide whether we've reached the end.
                if len(self.__allResultsLinks) == prev_count:
                    stagnant_rounds += 1

                    # Explicit end-of-list marker (best-effort; class names drift).
                    reached_end = self.driver.execute_script(
                        """
                        var nodes = document.querySelectorAll("[role='feed'] p, .PbZDve, .HlvSq");
                        for (var i = 0; i < nodes.length; i++) {
                            var t = (nodes[i].textContent || '').toLowerCase();
                            if (t.includes("you've reached the end") ||
                                t.includes("reached the end of the list")) {
                                return true;
                            }
                        }
                        return false;
                        """
                    )
                    if reached_end:
                        Communicator.show_message("Reached the end of the results list.")
                        break

                    if stagnant_rounds >= MAX_STAGNANT_ROUNDS:
                        Communicator.show_message(
                            f"No new results after {MAX_STAGNANT_ROUNDS} attempts; "
                            f"assuming end of list ({len(self.__allResultsLinks)} found)."
                        )
                        break

                    # Sometimes clicking the last card nudges more results to load.
                    try:
                        self.driver.execute_script(
                            "var a=document.getElementsByClassName('hfpxzc');"
                            "if(a.length){a[a.length-1].click();}"
                        )
                    except JavascriptException:
                        pass
                else:
                    stagnant_rounds = 0  # progress made, reset patience

            self.start_parsing()

    def _persist_links(self, new_links):
        """Batch-insert newly scrolled links + update the job's total_items."""
        if self.job_id is None:
            return
        try:
            conn = get_connection()
            cursor = conn.cursor()
            insert_data = [
                (self.job_id, self.query or "", link) for link in new_links
            ]
            cursor.executemany(
                """
                INSERT OR IGNORE INTO scrape_items (job_id, query, url, status)
                VALUES (?, ?, ?, 'pending')
                """,
                insert_data,
            )
            cursor.execute(
                """
                UPDATE scrape_jobs
                SET total_items = ?, current_step = 'scrolling', current_query = ?
                WHERE id = ?
                """,
                (len(self.__allResultsLinks), self.query or "", self.job_id),
            )
            conn.commit()
            conn.close()
        except Exception as db_err:
            Communicator.show_message(
                f"Warning: Could not save scrolled links to DB: {db_err}"
            )
