"""
This module contain the code for saving the scraped data
"""

import pandas as pd
from scraper.communicator import Communicator
from settings import OUTPUT_PATH
import os
from scraper.error_codes import ERROR_CODES
from db import get_connection
from scraper.datautils import (
    compute_dedup_hash,
    extract_coordinates,
    parse_address,
)


class DataSaver:
    def __init__(self) -> None:
        self.outputFormat = Communicator.get_output_format()

    def save(self, datalist):
        """
        This function will save the data that has been scrapped.
        This can be call if any error occurs while scraping , or if scraping is done successfully.
        In both cases we have to save the scraped data.
        """

        if len(datalist) > 0:
            Communicator.show_message("Saving the scraped data")

            dataFrame = pd.DataFrame(datalist)
            totalRecords = dataFrame.shape[0]

            searchQuery = Communicator.get_search_query()
            filename = f"{searchQuery} - GMS output"

            if self.outputFormat == "excel":
                extension = ".xlsx"
            elif self.outputFormat == "csv":
                extension = ".csv"
            elif self.outputFormat == "json":
                extension = ".json"

            # Create the output directory if it does not exist
            if not os.path.exists(OUTPUT_PATH):
                os.makedirs(OUTPUT_PATH)
            joinedPath = OUTPUT_PATH + filename + extension

            if os.path.exists(joinedPath):
                index = 1
                while True:
                    filename = f"{searchQuery} - GMS output ({index})"

                    joinedPath = OUTPUT_PATH + filename + extension

                    if os.path.exists(joinedPath):
                        index += 1

                    else:
                        break
            if self.outputFormat == "excel":
                dataFrame.to_excel(joinedPath, index=False)
            elif self.outputFormat == "csv":
                dataFrame.to_csv(joinedPath, index=False)

            elif self.outputFormat == "json":
                dataFrame.to_json(joinedPath, indent=4, orient="records")

            # Database Ingestion Sync
            try:
                # Normalization helpers come from datautils (shared with parser).
                # Find DB path robustly relative to script dir
                script_dir = os.path.dirname(os.path.abspath(__file__))
                db_path = os.path.join(
                    os.path.dirname(os.path.dirname(script_dir)), "data", "extractrx.db"
                )
                if not os.path.exists(db_path):
                    db_path = "data/extractrx.db"

                conn = get_connection(db_path)
                cursor = conn.cursor()

                inserted = 0
                for item in datalist:
                    name = item.get("Name")
                    if not name:
                        continue

                    category = item.get("Category")
                    phone = item.get("Phone")
                    gmaps_url = item.get("Google Maps URL")
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

                    enriched_company_info = item.get("enriched_company_info")
                    social_profiles = item.get("social_profiles")
                    owner_name = item.get("owner_name")
                    ceo_name = item.get("ceo_name")
                    coo_name = item.get("coo_name")
                    executives = item.get("executives")
                    linkedin_url = item.get("linkedin_url")
                    is_enriched = item.get("is_enriched", 0)

                    try:
                        cursor.execute(
                            """
                            INSERT INTO records (
                                category, name, phone, google_maps_url, website, email,
                                business_status, address, total_reviews, booking_links, rating, hours,
                                latitude, longitude, country, city, region, source_query,
                                tags, is_favorite, notes, dedup_hash, scraped_at, updated_at,
                                enriched_company_info, social_profiles, owner_name, ceo_name,
                                coo_name, executives, linkedin_url, is_enriched
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
                                enriched_company_info = COALESCE(excluded.enriched_company_info, records.enriched_company_info),
                                social_profiles = COALESCE(excluded.social_profiles, records.social_profiles),
                                owner_name = COALESCE(excluded.owner_name, records.owner_name),
                                ceo_name = COALESCE(excluded.ceo_name, records.ceo_name),
                                coo_name = COALESCE(excluded.coo_name, records.coo_name),
                                executives = COALESCE(excluded.executives, records.executives),
                                linkedin_url = COALESCE(excluded.linkedin_url, records.linkedin_url),
                                is_enriched = COALESCE(excluded.is_enriched, records.is_enriched),
                                updated_at = datetime('now')
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
                                searchQuery,
                                dedup_hash,
                                enriched_company_info,
                                social_profiles,
                                owner_name,
                                ceo_name,
                                coo_name,
                                executives,
                                linkedin_url,
                                is_enriched,
                            ),
                        )
                        inserted += 1
                    except Exception as e:
                        print(f"Failed to insert record {name} to SQLite: {e}")

                conn.commit()
                conn.close()
                Communicator.show_message(
                    f"Database sync complete: successfully saved/updated {inserted} records in SQLite."
                )
            except Exception as db_err:
                Communicator.show_message(
                    f"Warning: Could not sync scraped data to SQLite database. Error: {db_err}"
                )

            Communicator.show_message(
                f"Hurrah! Scraped data successfully saved! Total records saved: {totalRecords}. If you're loving this free tool, consider fueling us with a coffee! Your support helps us keep democratizing automation. ☕️ Support us here: https://www.buymeacoffee.com/extractrx"
            )

        else:
            Communicator.show_error_message(
                "Oops! Could not scrape the data because you did not scrape any record.",
                {ERROR_CODES["NO_RECORD_TO_SAVE"]},
            )

    def save_job_output(self, job_id, format_value, query_name):
        """
        Fetches all completed records for a specific job_id from SQLite
        and writes them to the specified output format (Excel, CSV, JSON).
        """
        try:
            import sqlite3
            import pandas as pd
            from settings import DB_PATH, OUTPUT_PATH

            # Connect and query records
            conn = get_connection()

            # Join records with scrape_items to get EXACTLY the ones completed for this job
            query = """
                SELECT r.category, r.name, r.phone, r.google_maps_url, r.website, r.email,
                       r.business_status, r.address, r.total_reviews, r.booking_links, r.rating, r.hours,
                       r.enriched_company_info, r.social_profiles, r.owner_name, r.ceo_name,
                       r.coo_name, r.executives, r.linkedin_url, r.is_enriched
                FROM records r
                JOIN scrape_items si ON r.google_maps_url = si.url
                WHERE si.job_id = ? AND si.status = 'completed'
            """

            df = pd.read_sql_query(query, conn, params=(job_id,))
            conn.close()

            if df.empty:
                Communicator.show_message(
                    "No completed records found in DB to write to output file."
                )
                return

            # Rename columns to match the output style of original scraper
            df.columns = [
                "Category",
                "Name",
                "Phone",
                "Google Maps URL",
                "Website",
                "email",
                "Business Status",
                "Address",
                "Total Reviews",
                "Booking Links",
                "Rating",
                "Hours",
                "Enriched Company Info",
                "Social Profiles",
                "Owner Name",
                "CEO Name",
                "COO Name",
                "Executives",
                "LinkedIn URL",
                "Is Enriched",
            ]

            totalRecords = df.shape[0]
            filename = f"{query_name} - GMS output"

            if format_value == "excel":
                extension = ".xlsx"
            elif format_value == "csv":
                extension = ".csv"
            elif format_value == "json":
                extension = ".json"
            else:
                extension = ".xlsx"

            if not os.path.exists(OUTPUT_PATH):
                os.makedirs(OUTPUT_PATH)

            joinedPath = os.path.join(OUTPUT_PATH, filename + extension)

            # Deconflict filename if it already exists (same as original code)
            if os.path.exists(joinedPath):
                index = 1
                while True:
                    filename = f"{query_name} - GMS output ({index})"
                    joinedPath = os.path.join(OUTPUT_PATH, filename + extension)
                    if os.path.exists(joinedPath):
                        index += 1
                    else:
                        break

            # Save
            if format_value == "excel":
                df.to_excel(joinedPath, index=False)
            elif format_value == "csv":
                df.to_csv(joinedPath, index=False)
            elif format_value == "json":
                df.to_json(joinedPath, indent=4, orient="records")

            Communicator.show_message(
                f"Combined output saved to: {joinedPath} ({totalRecords} records)."
            )

        except Exception as e:
            Communicator.show_message(f"Error saving job output files: {e}")
