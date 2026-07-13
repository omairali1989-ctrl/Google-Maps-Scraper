# Extractrix - Google Maps Scraper

## Version: 3.2.0

## Features

### Advanced Google Maps Business Data Extraction Tool

A powerful and intuitive Google Maps data extraction solution designed for both beginners and professionals. Featuring a modern web dashboard, it enables seamless navigation, efficient data collection, and rapid lead generation without requiring technical expertise.

#### Key Features

* ✅ Beginner-Friendly Interface – Clean, intuitive UI with no coding required.
* ✅ Comprehensive Business Data Extraction from Google Maps, including:
  * Business Category
  * Business Name
  * Phone Number
  * Google Maps Listing URL
  * Official Website
  * Email Address (where available)
  * Complete Address
  * Total Reviews Count
  * Average Rating
  * Business Operational Status
  * Online Booking / Reservation Links
  * Operating Hours

#### Ideal Use Cases

* * Lead Generation & Sales Prospecting
* * Local Business Directory Creation
* * B2B Data Collection
* * Marketing Campaign Targeting
* * Franchise & Location Intelligence

#### Benefits

* * Fast and scalable data collection
* * Accurate business intelligence gathering
* * Easy export for CRM, Excel, and marketing platforms
* * No technical expertise required
* * Optimized for high-volume business discovery and outreach
* * Fast and efficient 🚀

#### Automation & Reliability (Production Features)

* * **Concurrent jobs with a durable queue** — submit many scrapes at once; they run at a configurable concurrency limit and the rest queue automatically (Running / Queued / Completed / Failed states).
* * **Real-time monitoring** — live progress over Server-Sent Events, with a persistent, timestamped log per job and retry history.
* * **Auto-retry & failure recovery** — each location is retried with backoff before failing; orphaned jobs are recovered on restart.
* * **Analytics** — execution time, records processed, and success/failure rate via `/api/v2/analytics`.
* * **In-dashboard alerts** — failed jobs and critical errors surface as dismissable alerts.
* * **Anti-blocking** — user-agent rotation, proxy rotation, and per-domain rate limiting (configurable in Settings).
* * **Scheduling** — run scrapes at a future time, one-time or recurring.
* * **Concurrency-safe storage** — SQLite in WAL mode with busy timeouts so concurrent jobs never hit “database is locked”.

#### Website Lead Enrichment (no AI required)

Turn scraped businesses into qualified leads by crawling their websites — entirely rule-based, no API keys or LLM needed (though the existing AI enrichment still works alongside it).

* * **Async website crawl** — fetches homepage + contact/about pages over pooled `httpx` connections with retry/backoff (no browser, no Selenium).
* * **Contact extraction** — emails, phones (normalized to E.164 via `phonenumbers`), WhatsApp numbers, and social profiles (Facebook, Instagram, LinkedIn, YouTube, TikTok, Twitter/X).
* * **Metadata** — page title, meta description, and registrable domain.
* * **Validation** — email format check (`email-validator`) and phone validity, with a per-lead primary email/phone.
* * **Rule-based lead scoring (0–100, A–D)** — additive, transparent points for website/HTTPS/valid-email/valid-phone/socials/rating/reviews.
* * **Duplicate detection** — exact match on domain/phone/email plus fuzzy business-name + address matching (`rapidfuzz`), scoped per user.
* * **Runs on the shared job queue** — batches process with a bounded async worker pool; interrupted jobs resume (only un-enriched records are re-selected).
* * **Export** — enriched leads to CSV or JSON with all fields.

Open **Lead Enrichment** in the dashboard (or call the API) and click **Start Enrichment**. New REST endpoints (session-authenticated, per-user scoped):

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/v2/enrichment/start` | Start a website-enrichment batch over your records |
| `GET`  | `/api/v2/enrichment/status` | Poll a job (`?enrichment_job_id=`) or list recent jobs |
| `POST` | `/api/v2/enrichment/retry` | Re-run failed/unfinished records |
| `GET`  | `/api/v2/enrichment/export` | Export enriched leads (`?format=csv|json`) |

Adds new columns to the existing `records` table (`web_emails`, `web_phones`, `web_socials`, `lead_score`, `lead_grade`, `duplicate_of`, `web_enriched`, …) — migrations are automatic and idempotent, so existing data is preserved.

## Note

**Our all scrapers are working, if you find any issue or bug please open an issue with the detail of issue. We will try to resolve it quickly for you.**

![Extractrix open sourced google maps scraper](Readme assets/Extractrix google maps scraper.jpg)

Welcome to the Extractrix GitHub Google Maps Scraper repository, an open-source tool built with a Python (FastAPI + Selenium) backend and a Next.js web dashboard. This tool allows you to extract data from Google Maps through a user-friendly browser interface.
Documentation can be found at the [Extractrix Installation Guide](https://Extractrix.com/docs/google-maps-scraper/getting-started/installation/) 🔗

## Sample Data

```json
{
    "Category":"Shopping mall",
    "Name":"Packages Mall",
    "Phone":"(042) 111 696 255",
    "Google Maps URL":"https:\/\/www.google.com\/maps\/place\/Packages+Mall\/data=!4m7!3m6!1s0x39190680e8f2d445:0x32ba63a1571efb2a!8m2!3d31.4715199!4d74.3555422!16s%2Fg%2F11gmxj94jy!19sChIJRdTy6IAGGTkRKvseV6FjujI?authuser=0&hl=en&rclk=1",
    "Website":"http:\/\/www.packagesmall.com\/",
    "email":"careers@packagesmall.com, info@packagesmall.com",
    "Business Status":"Open⋅ Closes 10 pm",
    "Address":"Main Walton Rd, Shahrah-E-Roomi Nishtar Town, Lahore, Punjab 54750",
    "Total Reviews":"(67,295)",
    "Booking Links":null,
    "Rating":"4.6",
    "Hours":"Sunday11 am–10 pmMonday11 am–10 pmTuesday11 am–10 pmWednesday11 am–10 pmThursday11 am–10 pmFriday11 am–10 pmSaturday11 am–10 pmSuggest new hours"
}
```

## Architecture

Extractrix runs as a **web dashboard**, not a desktop GUI. It has two services:

* **Backend** — a FastAPI app (`app/main.py`) that drives a Selenium/undetected-chromedriver Google Maps scraper and exposes a JSON + SSE API on **port 5001**. It runs one Chrome process per job, managed by a concurrency-limited queue with a background dispatcher and scheduler.
* **Frontend** — a Next.js dashboard (`frontend/`) served on **port 3000** that submits scrape jobs, streams live progress, browses/exports results, and manages AI enrichment, proxies, rate limiting, and schedules.

Both services share a single SQLite database at `data/extractrx.db`, opened in WAL mode with busy timeouts so the two processes can read/write concurrently. The frontend owns the schema; the backend reads/writes the same file.

## Getting Started

To get started with the Google Maps Scraper, follow these steps:

### 1. Clone the repository to your local machine

```shell
git clone https://github.com/Extractrix/Google-Maps-Scraper.git
cd Google-Maps-Scraper
```

### 2. Install dependencies

This installs the Python backend (into a `venv`) and the Next.js frontend (`npm install`).

* **macOS / Linux:**
  ```bash
  ./setup.sh
  ```
* **Windows:**
  ```bat
  setup.bat
  ```

Requirements: **Python 3.9+** and **Node.js 18+**.

### 3. Chrome driver

* The bundled driver lives at `drivers/chromedriver`; its path is configured in `app/settings.py`.
* If it's missing or incompatible with your installed Chrome, download a matching build from the [Chrome for Testing page](https://googlechromelabs.github.io/chrome-for-testing/#stable) and update `DRIVER_EXECUTABLE_PATH` in `app/settings.py`.

### 4. Launch the dashboard

Start both the backend and frontend together:

* **macOS / Linux:**
  ```bash
  ./run_dashboard.sh
  ```
* **Windows:**
  ```bat
  run_dashboard.bat
  ```

Then open <http://localhost:3000> in your browser (the launch script opens it for you).

To run the services manually instead:

```shell
# Terminal 1 — backend API (port 5001)
python app/main.py

# Terminal 2 — frontend dashboard (port 3000)
cd frontend && npm run dev
```

The application features comprehensive test suites for both the frontend and backend.

#### Frontend Tests (Jest)

To run the frontend test suites:

```shell
cd frontend
npm test                  # Run all tests interactively
npm run test:coverage     # Run tests and generate a code coverage report
```

#### Backend Tests (Pytest)

To run the backend Python test suites (ensuring packages from `requirements-test.txt` are installed):

```shell
# Run all backend tests using the virtual environment
.venv/bin/python -m pytest
```

### Run with Docker (optional)

```shell
docker compose up --build
```

The frontend is served on <http://localhost:3000> and the backend API on <http://localhost:5001>.

### Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `CHROME_MAX_CONCURRENT` | `3` | Max scrape jobs running at once (each is a full Chrome). Clamped to a host-safe ceiling of 16; jobs over the limit queue automatically. |
| `FLASK_API_URL` | `http://localhost:5001` | Backend URL the frontend proxies to. |
| `IS_DOCKER` | – | When `true`, uses the container's `/usr/bin/chromedriver`. |

Anti-blocking (user-agent rotation, per-domain rate limit, proxies) and scheduled scrapes are configured from the dashboard's **Settings → Automation** panel and persist in the database.

> **A note on scale:** the scraper runs one real Chrome per job (~300–700MB each), so realistic single-host concurrency is a handful of jobs, not hundreds. The queue is designed so a distributed worker fleet could be swapped in for true horizontal scale; the local cap is intentionally clamped to protect the host.

### AI enrichment (optional)

The scraper can enrich leads (company summary, executives, social/LinkedIn profiles) via an LLM. Add an API key for your provider (OpenRouter, OpenAI, Groq, Claude, or Gemini) on the dashboard's **Settings** page, then enable enrichment when starting a scrape. Without a key it falls back to local extraction.

`For further helping docs please visit our` [documentation](https://Extractrix.com/docs/google-maps-scraper) `page`

## Contributing

We welcome contributions from the open-source community to enhance the Google Maps Scraper tool. If you would like to contribute, please follow these steps:

1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Make your changes and commit them with descriptive commit messages.
4. Push your changes to your forked repository.
5. Create a pull request to the `development` branch of the repository.
6. Wait for the code review and address any feedback received.
7. You can also contribute by updating the readme.md.

## License

The Google Maps Scraper tool is open-source software licensed under the [GNU GENERAL PUBLIC LICENSE](https://github.com/Extractrix/Google-Maps-Scraper/blob/main/LICENSE) 📜

## Support

If you encounter any issues or have any questions or suggestions, please feel free to open an issue. We appreciate your feedback and are here to assist you.

`Developed with Love for you ✨`

## Buy me a coffee☕

If you find my Google Maps scraper project helpful, consider supporting me with a coffee! Your contribution will help fuel late-night coding sessions and keep the code flowing. Every coffee is greatly appreciated and goes a long way in supporting the development of more useful tools and resources. Thank you for your generosity!

[![Buy Me A Coffee](https://img.buymeacoffee.com/button-api/?slug=Extractrix&button_colour=FFDD00&font_colour=000000&font_family=Lato&outline_colour=000000&coffee_colour=ffffff)](https://www.buymeacoffee.com/Extractrix)
