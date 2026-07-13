from bs4 import BeautifulSoup
from scraper.error_codes import ERROR_CODES
from scraper.communicator import Communicator
from scraper.datasaver import DataSaver
from scraper.base import Base
from scraper.common import Common
from settings import DB_PATH
from db import get_connection
from scraper.datautils import (
    compute_dedup_hash,
    extract_coordinates,
    parse_address,
    filter_previously_scraped,
)
import jobstore
import netpolicy
import requests
import re
import sqlite3
from scraper.enricher import LeadEnricher


class Parser(Base):

    # Per-location retry policy. Transient failures (slow page, stale DOM) are
    # retried with linear backoff before the item is marked permanently failed.
    MAX_ITEM_ATTEMPTS = 3
    RETRY_BACKOFF_SECONDS = 2

    def __init__(self, driver) -> None:
        self.driver = driver
        self.finalData = []
        self.job_id = None
        self.query = None
        self.comparing_tool_tips = {
            "location": "Copy address",
            "phone": "Copy phone number",
            "website": "Open website",
            "booking": "Open booking link",
        }
        self.enable_enrichment = False
        self.enrichment_model = None

    def init_data_saver(self):
        self.data_saver = DataSaver()

    def parse(self):
        """Our function to parse the html"""

        """This block will get element details sheet of a business. 
        Details sheet means that business details card when you click on a business in 
        serach results in google maps"""

        from selenium.webdriver.common.by import By

        infoSheet = None

        for _ in range(10):
            infoSheet = self.driver.execute_script(
                """return document.querySelector("[role='main']")"""
            )
            if infoSheet is not None:
                break
            Common.smart_sleep(0.5)

        if infoSheet is None:
            Communicator.show_message(
                "Warning: Details sheet [role='main'] did not load in time."
            )
            return

        try:
            # Initialize data points
            (
                rating,
                totalReviews,
                address,
                websiteUrl,
                email,
                phone,
                hours,
                category,
                gmapsUrl,
                bookingLink,
                businessStatus,
            ) = (None, None, None, None, None, None, None, None, None, None, None)

            html = infoSheet.get_attribute("outerHTML")
            soup = BeautifulSoup(html, "html.parser")

            # Extract rating
            try:
                rating = soup.find("span", class_="ceNzKf").get("aria-label")
                rating = rating.replace("stars", "").strip()
            except Exception:
                rating = None

            # Extract total reviews
            try:
                totalReviews = list(soup.find("div", class_="F7nice").children)
                totalReviews = totalReviews[1].get_text(strip=True)
            except Exception:
                totalReviews = None

            # Extract name
            try:
                name = soup.select_one(".tAiQdd h1.DUwDvf").text.strip()
            except Exception:
                name = None

            # Extract address, website, phone, and appointment link
            allInfoBars = soup.find_all("button", class_="CsEnBe")
            for infoBar in allInfoBars:
                data_tooltip = infoBar.get("data-tooltip")
                text = infoBar.find("div", class_="rogA2c").text.strip()

                if data_tooltip == self.comparing_tool_tips["location"]:
                    address = text

                elif data_tooltip == self.comparing_tool_tips["phone"]:
                    phone = text.strip()

            # Extract website URL
            try:
                websiteTag = soup.find(
                    "a", {"aria-label": lambda x: x and "Website:" in x}
                )
                if websiteTag:
                    websiteUrl = websiteTag.get("href")

            except Exception:
                websiteUrl = None

            website_html = ""
            if websiteUrl and self.enable_enrichment:
                try:
                    url_to_fetch = (
                        websiteUrl
                        if websiteUrl.startswith(("http://", "https://"))
                        else "https://" + websiteUrl
                    )
                    # UA-rotated, proxy-aware, rate-limited fetch.
                    res = netpolicy.get(url_to_fetch, timeout=5, allow_redirects=True)
                    if res.status_code == 200:
                        website_html = res.text
                except Exception:
                    pass

            # Extract Email
            try:
                if websiteUrl:
                    email = self.find_mail(websiteUrl)
            except Exception:
                email = None

            enriched_data = None
            if self.enable_enrichment and website_html and name:
                enricher = LeadEnricher(DB_PATH)
                provider = "openrouter"
                model_name = "google/gemini-2.5-flash-8b"
                if self.enrichment_model and "|" in self.enrichment_model:
                    provider, model_name = self.enrichment_model.split("|", 1)
                elif self.enrichment_model:
                    model_name = self.enrichment_model

                enriched_data = enricher.enrich_lead(
                    website_html, name, provider=provider, model=model_name
                )

            # Extract booking link
            try:
                bookingTag = soup.find(
                    "a", {"aria-label": lambda x: x and "Open booking link" in x}
                )
                if bookingTag:
                    bookingLink = bookingTag.get("href")
            except Exception:
                bookingLink = None

            # Extract hours of operation
            try:
                hours = soup.find("div", class_="t39EBf").get_text(strip=True)
            except Exception:
                hours = None

            # Extract category
            try:
                category = soup.find("button", class_="DkEaL").text.strip()
            except Exception:
                category = None

            # Extract Google Maps URL
            try:
                gmapsUrl = self.driver.current_url
            except Exception:
                gmapsUrl = None

            # Extract business status
            try:
                businessStatus = (
                    soup.find("span", class_="ZDu9vd")
                    .findChildren("span", recursive=False)[0]
                    .get_text(strip=True)
                )
            except Exception:
                businessStatus = None

            data = {
                "Category": category,
                "Name": name,
                "Phone": phone,
                "Google Maps URL": gmapsUrl,
                "Website": websiteUrl,
                "email": email,
                "Business Status": businessStatus,
                "Address": address,
                "Total Reviews": totalReviews,
                "Booking Links": bookingLink,
                "Rating": rating,
                "Hours": hours,
            }

            if enriched_data:
                data["is_enriched"] = 1
                data["enriched_company_info"] = enriched_data.get(
                    "enriched_company_info"
                )
                data["social_profiles"] = enriched_data.get("social_profiles")
                data["owner_name"] = enriched_data.get("owner_name")
                data["ceo_name"] = enriched_data.get("ceo_name")
                data["coo_name"] = enriched_data.get("coo_name")
                data["executives"] = enriched_data.get("executives")
                data["linkedin_url"] = enriched_data.get("linkedin_url")
            else:
                data["is_enriched"] = 0
                data["enriched_company_info"] = None
                data["social_profiles"] = None
                data["owner_name"] = None
                data["ceo_name"] = None
                data["coo_name"] = None
                data["executives"] = None
                data["linkedin_url"] = None

            self.finalData.append(data)

        except Exception as e:
            Communicator.show_error_message(
                f"Error occurred while parsing a location. Error is: {str(e)}",
                ERROR_CODES["ERR_WHILE_PARSING_DETAILS"],
            )

    # find email
    def find_mail(self, url):
        try:
            if not url.startswith(("http://", "https://")):
                url = "https://" + url

            try:
                source_code = netpolicy.get(url, timeout=5, allow_redirects=True)
                curr = source_code.url
                plain_text = source_code.text
            except Exception:
                if url.startswith("https://"):
                    try:
                        url_http = url.replace("https://", "http://")
                        source_code = netpolicy.get(
                            url_http, timeout=5, allow_redirects=True
                        )
                        curr = source_code.url
                        plain_text = source_code.text
                    except Exception:
                        return ""
                else:
                    return ""

            original_curr = curr
            match = re.findall(
                r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", plain_text
            )

            if not match:
                base_url = original_curr.rstrip("/")
                sub_urls = [
                    base_url + "/contact",
                    base_url + "/contact-us",
                    base_url + "/about",
                    base_url + "/about-us",
                ]
                
                import concurrent.futures
                
                def check_sub_url(sub_url):
                    try:
                        sub_response = netpolicy.get(
                            sub_url, timeout=5, allow_redirects=True
                        )
                        if sub_response.status_code == 200:
                            found = re.findall(
                                r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}",
                                sub_response.text,
                            )
                            return found
                    except Exception:
                        pass
                    return []

                with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
                    futures = [executor.submit(check_sub_url, u) for u in sub_urls]
                    for future in concurrent.futures.as_completed(futures):
                        found_emails = future.result()
                        if found_emails:
                            match = found_emails
                            break
                            
            if not match:
                match = re.findall(
                    r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", original_curr
                )

            valid_emails = []
            if match:
                for email in set(match):
                    email = email.strip()
                    lower_email = email.lower()
                    if not any(
                        lower_email.endswith(ext)
                        for ext in [
                            ".png",
                            ".jpg",
                            ".jpeg",
                            ".gif",
                            ".webp",
                            ".svg",
                            ".css",
                            ".js",
                        ]
                    ):
                        if re.match(
                            r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$", email
                        ):
                            valid_emails.append(email)

            return ", ".join(valid_emails)

        except Exception as e:
            Communicator.show_message(f"Error in find_mail: {e}")
        return ""

    def save_single_record(self, item, url, status="completed", error_message=None):
        if self.job_id is None:
            return

        try:
            # Normalization helpers live in datautils (single source of truth).
            conn = get_connection()
            cursor = conn.cursor()

            if status == "completed" and item.get("Name"):
                name = item.get("Name")
                category = item.get("Category")
                phone = item.get("Phone")
                gmaps_url = item.get("Google Maps URL") or url
                website = item.get("Website")
                email = item.get("email") or item.get("Email")
                business_status = item.get("Business Status")
                address = item.get("Address")
                total_reviews = item.get("Total Reviews")
                booking_links = item.get("Booking Links")
                rating = item.get("Rating")
                hours = item.get("Hours")

                dedup_hash = compute_dedup_hash(name, address, phone)
                lat, lng = extract_coordinates(gmaps_url)
                country, city, region = parse_address(address)

                cursor.execute(
                    """
                    INSERT INTO records (
                        category, name, phone, google_maps_url, website, email,
                        business_status, address, total_reviews, booking_links, rating, hours,
                        latitude, longitude, country, city, region, source_query,
                        tags, is_favorite, notes, dedup_hash, scraped_at, updated_at,
                        is_enriched, enriched_company_info, social_profiles, owner_name, ceo_name, coo_name, executives, linkedin_url
                    ) VALUES (
                        ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?,
                        '[]', 0, '', ?, datetime('now'), datetime('now'),
                        ?, ?, ?, ?, ?, ?, ?, ?
                    )
                    ON CONFLICT(dedup_hash) DO UPDATE SET
                        category = COALESCE(excluded.category, records.category),
                        phone = COALESCE(excluded.phone, records.phone),
                        google_maps_url = COALESCE(excluded.google_maps_url, records.google_maps_url),
                        website = COALESCE(excluded.website, records.website),
                        email = COALESCE(excluded.email, records.email),
                        business_status = COALESCE(excluded.business_status, records.business_status),
                        address = COALESCE(excluded.address, records.address),
                        total_reviews = COALESCE(excluded.total_reviews, records.total_reviews),
                        booking_links = COALESCE(excluded.booking_links, records.booking_links),
                        rating = COALESCE(excluded.rating, records.rating),
                        hours = COALESCE(excluded.hours, records.hours),
                        latitude = COALESCE(excluded.latitude, records.latitude),
                        longitude = COALESCE(excluded.longitude, records.longitude),
                        country = COALESCE(excluded.country, records.country),
                        city = COALESCE(excluded.city, records.city),
                        region = COALESCE(excluded.region, records.region),
                        source_query = COALESCE(excluded.source_query, records.source_query),
                        updated_at = datetime('now'),
                        is_enriched = COALESCE(excluded.is_enriched, records.is_enriched),
                        enriched_company_info = COALESCE(excluded.enriched_company_info, records.enriched_company_info),
                        social_profiles = COALESCE(excluded.social_profiles, records.social_profiles),
                        owner_name = COALESCE(excluded.owner_name, records.owner_name),
                        ceo_name = COALESCE(excluded.ceo_name, records.ceo_name),
                        coo_name = COALESCE(excluded.coo_name, records.coo_name),
                        executives = COALESCE(excluded.executives, records.executives),
                        linkedin_url = COALESCE(excluded.linkedin_url, records.linkedin_url)
                """,
                    (
                        category,
                        name,
                        phone,
                        gmaps_url,
                        website,
                        email,
                        business_status,
                        address,
                        total_reviews,
                        booking_links,
                        rating,
                        hours,
                        lat,
                        lng,
                        country,
                        city,
                        region,
                        self.query or "",
                        dedup_hash,
                        item.get("is_enriched", 0),
                        item.get("enriched_company_info"),
                        item.get("social_profiles"),
                        item.get("owner_name"),
                        item.get("ceo_name"),
                        item.get("coo_name"),
                        item.get("executives"),
                        item.get("linkedin_url"),
                    ),
                )

            # Update scrape_items table for this URL
            cursor.execute(
                """
                UPDATE scrape_items
                SET status = ?, error_message = ?, scraped_at = datetime('now')
                WHERE job_id = ? AND url = ?
            """,
                (status, error_message, self.job_id, url),
            )

            # Calculate counts optimally
            cursor.execute(
                """
                SELECT status, COUNT(*) 
                FROM scrape_items 
                WHERE job_id = ? 
                GROUP BY status
            """,
                (self.job_id,),
            )

            status_counts = dict(cursor.fetchall())
            success_count = status_counts.get("completed", 0)
            failure_count = status_counts.get("failed", 0)
            pending_count = status_counts.get("pending", 0)
            processing_count = status_counts.get("processing", 0)

            total_items = (
                success_count + failure_count + pending_count + processing_count
            )
            processed_items = success_count + failure_count

            # Update scrape_jobs table
            cursor.execute(
                """
                UPDATE scrape_jobs
                SET processed_items = ?,
                    success_count = ?,
                    failure_count = ?,
                    record_count = ?,
                    current_step = 'scraping',
                    current_query = ?
                WHERE id = ?
            """,
                (
                    processed_items,
                    success_count,
                    failure_count,
                    success_count,
                    self.query or "",
                    self.job_id,
                ),
            )

            conn.commit()
            conn.close()

            # Logging real-time progress
            progress_percent = (
                int((processed_items / total_items) * 100) if total_items > 0 else 0
            )
            current_name = (
                item.get("Name") or "Unknown"
                if status == "completed"
                else "Failed to parse"
            )
            Communicator.show_message(
                f"[Scraper Progress]: {processed_items}/{total_items} parsed "
                f"(Success: {success_count}, Failed: {failure_count}) | "
                f"Est. Progress: {progress_percent}% | "
                f"Active Listing: {current_name}"
            )

        except Exception as e:
            Communicator.show_message(f"Error updating progress in SQLite: {e}")

    def main(self, allResultsLinks):
        Communicator.show_message(
            "Scrolling is done. Now going to scrape each location"
        )
        # Cross-job dedup (same-user): skip businesses this user already has.
        if self.job_id is not None:
            allResultsLinks, skipped = filter_previously_scraped(
                self.job_id, allResultsLinks
            )
            if skipped:
                Communicator.show_message(
                    f"Skipping {skipped} previously-scraped location(s) for this user."
                )
        try:
            self.finalData = []
            for idx, resultLink in enumerate(allResultsLinks):
                if Common.close_thread_is_set():
                    self.driver.quit()
                    return

                # Mark item as processing in DB
                if self.job_id is not None:
                    try:
                        conn = get_connection()
                        cursor = conn.cursor()
                        cursor.execute(
                            """
                            UPDATE scrape_items
                            SET status = 'processing'
                            WHERE job_id = ? AND url = ?
                        """,
                            (self.job_id, resultLink),
                        )
                        conn.commit()
                        conn.close()
                    except Exception:
                        pass

                # Retry each location a few times with backoff before giving up.
                # Transient page loads / stale DOM are the common failure mode.
                extracted = False
                last_reason = "Could not extract details"
                for attempt in range(1, self.MAX_ITEM_ATTEMPTS + 1):
                    if Common.close_thread_is_set():
                        self.driver.quit()
                        return

                    self.openingurl(url=resultLink)

                    prev_len = len(self.finalData)
                    try:
                        self.parse()
                    except Exception as parse_e:
                        last_reason = str(parse_e)
                        Communicator.show_message(
                            f"Error parsing {resultLink} (attempt {attempt}/"
                            f"{self.MAX_ITEM_ATTEMPTS}): {parse_e}"
                        )

                    if len(self.finalData) > prev_len:
                        new_item = self.finalData[-1]
                        self.save_single_record(
                            new_item, resultLink, status="completed"
                        )
                        extracted = True
                        break

                    # Failed this attempt — record retry history and back off.
                    if attempt < self.MAX_ITEM_ATTEMPTS:
                        try:
                            jobstore.record_retry(
                                self.job_id, resultLink, attempt, last_reason
                            )
                        except Exception:
                            pass
                        Common.smart_sleep(self.RETRY_BACKOFF_SECONDS * attempt)

                if not extracted:
                    self.save_single_record(
                        {},
                        resultLink,
                        status="failed",
                        error_message=last_reason,
                    )

        except Exception as e:
            Communicator.show_message(
                f"Error occurred while parsing the locations. Error: {str(e)}"
            )

        finally:
            if self.job_id is not None:
                self.init_data_saver()
                self.data_saver.save_job_output(
                    self.job_id, self.data_saver.outputFormat, self.query or "Scraper"
                )
            else:
                self.init_data_saver()
                self.data_saver.save(datalist=self.finalData)
