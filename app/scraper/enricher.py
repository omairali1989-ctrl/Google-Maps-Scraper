import json
import sqlite3
import requests
from bs4 import BeautifulSoup
from .communicator import Communicator
from db import get_connection


class LeadEnricher:
    def __init__(self, db_path):
        self.db_path = db_path
        self.api_keys = self._load_api_keys()

    def _load_api_keys(self):
        keys = {}
        try:
            conn = get_connection(self.db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT provider, api_key FROM api_keys WHERE is_active = 1")
            rows = cursor.fetchall()
            for row in rows:
                keys[row[0].lower()] = row[1]
            conn.close()
        except Exception as e:
            Communicator.show_message(f"Error loading API keys: {e}")
        return keys

    def extract_text_from_html(self, html):
        if not html:
            return ""
        soup = BeautifulSoup(html, "html.parser")
        # Remove script and style elements
        for script in soup(["script", "style", "noscript", "meta", "link"]):
            script.extract()

        # Get text and clean it
        text = soup.get_text(separator=" ")
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        text = "\n".join(chunk for chunk in chunks if chunk)
        # Limit to 15k characters to prevent massive token usage
        return text[:15000]

    def _get_provider_config(self, provider_name):
        configs = {
            "openrouter": {
                "url": "https://openrouter.ai/api/v1/chat/completions",
                "headers": lambda key: {
                    "Authorization": f"Bearer {key}",
                    "HTTP-Referer": "https://github.com/zubair-xyz/Google-Maps-Scraper",
                    "Content-Type": "application/json",
                },
            },
            "groq": {
                "url": "https://api.groq.com/openai/v1/chat/completions",
                "headers": lambda key: {
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
            },
                        "claude": {
                "url": "https://api.anthropic.com/v1/messages",
                "headers": lambda key: {
                    "x-api-key": key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
            },
            "gemini": {
                "url": "gemini",  # Special case: URL depends on model and key
                "headers": lambda key: {
                    "Content-Type": "application/json",
                },
            },
            "openai": {
                "url": "https://api.openai.com/v1/chat/completions",
                "headers": lambda key: {
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
            },
        }
        return configs.get(provider_name.lower())

    def enrich_lead(
        self,
        html_content,
        company_name,
        provider="openrouter",
        model="google/gemini-2.5-flash",
    ):
        website_text = self.extract_text_from_html(html_content)
        if not website_text:
            return None

        # Check if local fallback or hybrid/mix is requested
        use_fallback = False
        is_hybrid = False
        
        provider_lower = provider.lower()
        if provider_lower == "local":
            use_fallback = True
        elif provider_lower in ["mix", "hybrid"]:
            is_hybrid = True
            # Find first active AI provider with a key
            ai_provider = None
            for p in ["openrouter", "groq", "openai", "claude", "gemini"]:
                if p in self.api_keys:
                    ai_provider = p
                    break
            if not ai_provider:
                Communicator.show_message(
                    "Hybrid Mode: No active API key found for any AI provider. Defaulting to local extraction..."
                )
                use_fallback = True
            else:
                provider = ai_provider
                provider_lower = ai_provider.lower()
                if model.lower() in ["mix", "hybrid", "local"]:
                    # Match suitable model for the chosen provider
                    if provider == "openrouter":
                        model = "google/gemini-2.5-flash"
                    elif provider == "groq":
                        model = "llama3-8b-8192"
                    elif provider == "openai":
                        model = "gpt-4o-mini"
                    elif provider == "claude":
                        model = "claude-3-haiku-20240307"
                    elif provider == "gemini":
                        model = "gemini-2.5-flash"

        # Check if the chosen AI provider has a key
        if not use_fallback and provider_lower not in self.api_keys:
            Communicator.show_message(
                f"No active API key found for {provider}. Falling back to local python extraction..."
            )
            use_fallback = True

        if use_fallback:
            return self._fallback_local_extraction(html_content, company_name, website_text)

        api_key = self.api_keys[provider_lower]
        config = self._get_provider_config(provider)

        if not config:
            Communicator.show_message(
                f"Skipping enrichment: Provider {provider} not supported."
            )
            return None

        prompt = f"""
You are an expert lead enrichment AI. Analyze the following text extracted from the official website of the company "{company_name}".
Your goal is to extract the following information. If a piece of information is not found, return null.

Information to extract:
1. "enriched_company_info": A short 1-2 sentence summary of what the company does.
2. "social_profiles": A comma-separated list of social media URLs found (Facebook, Twitter, Instagram, etc).
3. "owner_name": Name of the business owner or founder.
4. "ceo_name": Name of the CEO.
5. "coo_name": Name of the COO.
6. "executives": A comma-separated list of other key executives (CFO, CTO, VPs, etc).
7. "linkedin_url": The LinkedIn URL for the company or its main executives.

Return the result STRICTLY as a JSON object with these exact keys. Do NOT include markdown blocks or any other text.

Website Text:
---
{website_text}
---
"""

        try:
            Communicator.show_message(
                f"AI Enrichment: Processing {company_name} via {provider} ({model})..."
            )
            
            prompt_tokens = 0
            completion_tokens = 0
            content = ""

            if provider.lower() == "claude":
                payload = {
                    "model": model,
                    "max_tokens": 1024,
                    "messages": [{"role": "user", "content": prompt}]
                }
                response = requests.post(
                    config["url"],
                    headers=config["headers"](api_key),
                    json=payload,
                    timeout=30,
                )
                response.raise_for_status()
                data = response.json()
                content = data["content"][0]["text"]
                usage = data.get("usage", {})
                prompt_tokens = usage.get("input_tokens", 0)
                completion_tokens = usage.get("output_tokens", 0)
                
            elif provider.lower() == "gemini":
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
                payload = {
                  "contents": [{
                    "parts":[{"text": prompt}]
                  }],
                  "generationConfig": {
                    "responseMimeType": "application/json"
                  }
                }
                response = requests.post(
                    url,
                    headers=config["headers"](api_key),
                    json=payload,
                    timeout=30,
                )
                response.raise_for_status()
                data = response.json()
                content = data["candidates"][0]["content"]["parts"][0]["text"]
                usage = data.get("usageMetadata", {})
                prompt_tokens = usage.get("promptTokenCount", 0)
                completion_tokens = usage.get("candidatesTokenCount", 0)
                
            else:
                payload = {
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "response_format": {"type": "json_object"},
                }
                response = requests.post(
                    config["url"],
                    headers=config["headers"](api_key),
                    json=payload,
                    timeout=30,
                )
                response.raise_for_status()
                data = response.json()
                content = data["choices"][0]["message"]["content"]
                usage = data.get("usage", {})
                prompt_tokens = usage.get("prompt_tokens", 0)
                completion_tokens = usage.get("completion_tokens", 0)

            # Record usage in DB
            self._record_usage(provider, model, prompt_tokens, completion_tokens)

            # Parse JSON
            enriched_data = json.loads(content)
            enriched_data["is_enriched"] = 1

            if is_hybrid:
                # Merge local extraction with AI results
                try:
                    local_data = self._fallback_local_extraction(html_content, company_name, website_text)
                    for key in ["social_profiles", "linkedin_url", "enriched_company_info"]:
                        val_local = local_data.get(key)
                        val_ai = enriched_data.get(key)
                        if not val_ai and val_local:
                            enriched_data[key] = val_local
                        elif val_local:
                            if key == "social_profiles":
                                ai_profiles = [p.strip() for p in str(val_ai).split(",") if p.strip()]
                                local_profiles = [p.strip() for p in str(val_local).split(",") if p.strip()]
                                merged_profiles = list(set(ai_profiles + local_profiles))
                                if merged_profiles:
                                    enriched_data["social_profiles"] = ",".join(merged_profiles)
                except Exception as merge_err:
                    Communicator.show_message(f"Warning: Failed to merge hybrid results: {merge_err}")

            return enriched_data

        except requests.exceptions.RequestException as e:
            Communicator.show_message(f"Enrichment API Error for {company_name}: {e}")
            if hasattr(e, "response") and e.response is not None:
                Communicator.show_message(f"API Response: {e.response.text}")
            Communicator.show_message("Falling back to local extraction due to API error...")
            return self._fallback_local_extraction(html_content, company_name, website_text)
        except json.JSONDecodeError as e:
            Communicator.show_message(
                f"Enrichment JSON Parse Error for {company_name}: {e}\nRaw output: {content}"
            )
            Communicator.show_message("Falling back to local extraction due to parsing error...")
            return self._fallback_local_extraction(html_content, company_name, website_text)
        except Exception as e:
            Communicator.show_message(
                f"Unexpected Enrichment Error for {company_name}: {e}"
            )
            return self._fallback_local_extraction(html_content, company_name, website_text)

    def _fallback_local_extraction(self, html_content, company_name, website_text):
        import re
        Communicator.show_message(f"Local Enrichment: Processing {company_name}...")

        # ------------------------------------------------------------------
        # 1. Use the advanced webenrich extractors when available
        # ------------------------------------------------------------------
        try:
            from .webenrich.extract import (
                extract_emails, extract_phones, extract_whatsapp,
                extract_socials, extract_title_description,
            )
            extracted_emails = extract_emails(html_content)
            extracted_phones = extract_phones(html_content)
            extracted_whatsapp = extract_whatsapp(html_content)
            extracted_socials = extract_socials(html_content)
            meta = extract_title_description(html_content)
        except Exception:
            # Graceful degradation — run inline regex if webenrich unavailable
            extracted_emails = self._extract_emails_regex(html_content)
            extracted_phones = self._extract_phones_regex(html_content)
            extracted_whatsapp = self._extract_whatsapp_regex(html_content)
            extracted_socials = self._extract_socials_regex(html_content)
            meta = self._extract_meta(html_content)

        # ------------------------------------------------------------------
        # 2. Social profiles → flat comma-separated + dedicated linkedin_url
        # ------------------------------------------------------------------
        social_list = list(extracted_socials.values()) if isinstance(extracted_socials, dict) else []
        # Also run the original broad regex to catch any extras
        for m in re.finditer(
            r'https?://(?:www\.)?(?:facebook|twitter|instagram|linkedin|youtube|tiktok|pinterest|github|x)\.com/[^\s"\'<>]+',
            html_content, re.IGNORECASE
        ):
            url = m.group(0).rstrip("/.,;:!?)")
            if url not in social_list:
                social_list.append(url)

        linkedin_url = None
        if isinstance(extracted_socials, dict) and extracted_socials.get("linkedin"):
            linkedin_url = extracted_socials["linkedin"]
        if not linkedin_url:
            linkedin_url = next((u for u in social_list if "linkedin" in u.lower()), None)

        # ------------------------------------------------------------------
        # 3. Company info — try meta description, then first relevant sentence
        # ------------------------------------------------------------------
        company_info = None
        if meta.get("description"):
            company_info = meta["description"]
        if not company_info:
            sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+', website_text) if s.strip()]
            for s in sentences:
                if company_name.lower() in s.lower() and len(s) > 20:
                    company_info = s
                    break
            if not company_info and sentences:
                # Take the longest meaningful sentence as a fallback
                candidates = [s for s in sentences if len(s) > 30]
                if candidates:
                    company_info = max(candidates, key=len)[:300]

        # ------------------------------------------------------------------
        # 4. Extract emails (format: comma-separated for display)
        # ------------------------------------------------------------------
        email_primary = None
        if extracted_emails:
            try:
                from .webenrich.validate import pick_primary_email
                email_primary, _ = pick_primary_email(extracted_emails)
            except Exception:
                email_primary = extracted_emails[0] if extracted_emails else None

        # ------------------------------------------------------------------
        # 5. Extract phone (format: best available)
        # ------------------------------------------------------------------
        phone_primary = None
        if extracted_phones:
            try:
                from .webenrich.validate import pick_primary_phone
                phone_primary, _ = pick_primary_phone(extracted_phones)
            except Exception:
                phone_primary = extracted_phones[0] if extracted_phones else None

        # ------------------------------------------------------------------
        # 6. Extract physical address
        # ------------------------------------------------------------------
        address = self._extract_address(html_content, website_text)

        # ------------------------------------------------------------------
        # 7. Extract business hours
        # ------------------------------------------------------------------
        business_hours = self._extract_business_hours(html_content, website_text)

        # ------------------------------------------------------------------
        # 8. Detect technologies
        # ------------------------------------------------------------------
        technologies = self._detect_technologies(html_content)

        # ------------------------------------------------------------------
        # 9. Extract executive / people names
        # ------------------------------------------------------------------
        executives_found = self._extract_people_names(html_content, website_text)

        # ------------------------------------------------------------------
        # 10. Compute a lead quality score
        # ------------------------------------------------------------------
        lead_score = self._compute_lead_score(
            has_email=bool(extracted_emails),
            has_phone=bool(extracted_phones),
            has_whatsapp=bool(extracted_whatsapp),
            has_linkedin=bool(linkedin_url),
            social_count=len(social_list),
            has_address=bool(address),
        )

        return {
            "enriched_company_info": company_info or f"{company_name} is a business with a web presence.",
            "social_profiles": ",".join(list(set(social_list))) if social_list else None,
            "owner_name": executives_found.get("owner") or executives_found.get("founder"),
            "ceo_name": executives_found.get("ceo"),
            "coo_name": executives_found.get("coo"),
            "executives": ",".join(executives_found.get("others", [])) if executives_found.get("others") else None,
            "linkedin_url": linkedin_url,
            "is_enriched": 1,
            # Extended fields
            "emails": ",".join(extracted_emails) if extracted_emails else None,
            "email_primary": email_primary,
            "phones": ",".join(extracted_phones) if extracted_phones else None,
            "phone_primary": phone_primary,
            "whatsapp": ",".join(extracted_whatsapp) if extracted_whatsapp else None,
            "website_title": meta.get("title"),
            "website_description": meta.get("description"),
            "address": address,
            "business_hours": business_hours,
            "technologies": ",".join(technologies) if technologies else None,
            "lead_score": lead_score,
        }

    # ======================================================================
    # Helper extraction methods (all pure-Python, no external API calls)
    # ======================================================================

    def _extract_emails_regex(self, html):
        """Fallback email extraction using regex."""
        import re
        blocklist = ("example.com", "sentry.io", "wixpress.com", "@2x", ".png", ".jpg", ".svg", ".gif")
        emails = []
        for m in re.findall(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', html or ""):
            e = m.strip().lower()
            if not any(bad in e for bad in blocklist) and e not in emails:
                emails.append(e)
        return emails

    def _extract_phones_regex(self, html):
        """Fallback phone extraction using regex."""
        import re
        phones = []
        # tel: links first
        for m in re.findall(r'href=["\']tel:([^"\']+)', html or "", re.I):
            raw = m.strip()
            if raw and raw not in phones:
                phones.append(raw)
        if phones:
            return phones
        # Text-based scan
        text = BeautifulSoup(html or "", "html.parser").get_text(separator=" ")
        for m in re.findall(r'(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?(?:[\s.-]\d{2,4}){1,4}', text):
            m = m.strip()
            digits = re.sub(r'\D', '', m)
            if 7 <= len(digits) <= 15 and re.search(r'[+()\-.]', m):
                if m not in phones:
                    phones.append(m)
        return phones

    def _extract_whatsapp_regex(self, html):
        """Extract WhatsApp numbers from wa.me / api.whatsapp.com links."""
        import re
        out = []
        for m in re.findall(r'https?://(?:wa\.me|api\.whatsapp\.com/send)[^"\'\s<>]*', html or "", re.I):
            digits = re.sub(r'\D', '', m.split("phone=")[-1] if "phone=" in m else m)
            tail = m.rstrip("/").split("/")[-1]
            tail_digits = re.sub(r'\D', '', tail)
            num = tail_digits or digits
            if 7 <= len(num) <= 15 and num not in out:
                out.append(num)
        return out

    def _extract_socials_regex(self, html):
        """Fallback social profile extraction using regex."""
        import re
        from urllib.parse import urlparse
        socials = {}
        hosts_map = {
            "facebook": ("facebook.com", "fb.com"),
            "instagram": ("instagram.com",),
            "linkedin": ("linkedin.com",),
            "twitter": ("twitter.com", "x.com"),
            "youtube": ("youtube.com", "youtu.be"),
            "tiktok": ("tiktok.com",),
        }
        ignore = ("/sharer", "/share", "/intent/", "/plugins/", "/dialog/", "/embed")
        for href in re.findall(r'href=["\']([^"\']+)["\']', html or "", re.I):
            if not href.lower().startswith(("http://", "https://")):
                continue
            low = href.lower()
            if any(bad in low for bad in ignore):
                continue
            host = urlparse(href).netloc.lower().lstrip("www.")
            path = urlparse(href).path.strip("/")
            for platform, domains in hosts_map.items():
                if platform not in socials and any(host == d or host.endswith("." + d) for d in domains) and path:
                    socials[platform] = href.split("?")[0]
        return socials

    def _extract_meta(self, html):
        """Extract page title and meta description."""
        import re
        title = None
        description = None
        m = re.search(r'<title[^>]*>(.*?)</title>', html or "", re.I | re.S)
        if m:
            title = re.sub(r'\s+', ' ', m.group(1)).strip()[:300] or None
        m = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']*)', html or "", re.I)
        if m:
            description = m.group(1).strip()[:600] or None
        if not description:
            m = re.search(r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']*)', html or "", re.I)
            if m:
                description = m.group(1).strip()[:600] or None
        return {"title": title, "description": description}

    def _extract_address(self, html, text):
        """Extract physical/postal address from structured data or text patterns."""
        import re
        # Try structured data (schema.org JSON-LD)
        for m in re.findall(r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html or "", re.I | re.S):
            try:
                data = json.loads(m)
                if isinstance(data, list):
                    data = data[0] if data else {}
                addr = data.get("address")
                if isinstance(addr, dict):
                    parts = [
                        addr.get("streetAddress", ""),
                        addr.get("addressLocality", ""),
                        addr.get("addressRegion", ""),
                        addr.get("postalCode", ""),
                        addr.get("addressCountry", ""),
                    ]
                    result = ", ".join(p.strip() for p in parts if p and p.strip())
                    if result:
                        return result
                elif isinstance(addr, str) and addr.strip():
                    return addr.strip()
            except (json.JSONDecodeError, AttributeError, TypeError):
                pass

        # Try common HTML patterns
        soup = BeautifulSoup(html or "", "html.parser")
        for selector in [
            {"itemprop": "address"}, {"class": re.compile(r"address", re.I)},
            {"id": re.compile(r"address", re.I)},
        ]:
            tag = soup.find(attrs=selector)
            if tag:
                addr_text = tag.get_text(separator=", ").strip()
                if 10 < len(addr_text) < 300:
                    return addr_text

        # Regex for US-style addresses (e.g., "123 Main St, City, ST 12345")
        m = re.search(
            r'\d{1,5}\s+[\w\s]+(?:St(?:reet)?|Ave(?:nue)?|Blvd|Dr(?:ive)?|Rd|Road|Ln|Lane|Way|Ct|Court|Pl(?:ace)?)'
            r'[.,]?\s+[\w\s]+[.,]?\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?',
            text or ""
        )
        if m:
            return m.group(0).strip()

        return None

    def _extract_business_hours(self, html, text):
        """Extract business/opening hours from structured data or text."""
        import re
        # Try schema.org JSON-LD
        for m in re.findall(r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html or "", re.I | re.S):
            try:
                data = json.loads(m)
                if isinstance(data, list):
                    data = data[0] if data else {}
                hours = data.get("openingHoursSpecification") or data.get("openingHours")
                if hours:
                    if isinstance(hours, list):
                        parts = []
                        for h in hours:
                            if isinstance(h, dict):
                                day = h.get("dayOfWeek", "")
                                if isinstance(day, list):
                                    day = ", ".join(str(d).split("/")[-1] for d in day)
                                elif isinstance(day, str):
                                    day = day.split("/")[-1]
                                opens = h.get("opens", "")
                                closes = h.get("closes", "")
                                parts.append(f"{day}: {opens}-{closes}")
                            elif isinstance(h, str):
                                parts.append(h)
                        return "; ".join(parts) if parts else None
                    elif isinstance(hours, str):
                        return hours
            except (json.JSONDecodeError, AttributeError, TypeError):
                pass

        # Common text patterns like "Mon-Fri: 9am-5pm" or "Monday to Friday 9:00-17:00"
        hours_pattern = re.compile(
            r'(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)'
            r'(?:\s*[-–to]+\s*(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?))?'
            r'\s*[:]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?\s*[-–to]+\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?',
            re.IGNORECASE
        )
        matches = hours_pattern.findall(text or "")
        if matches:
            return "; ".join(m.strip() for m in matches[:7])

        return None

    def _detect_technologies(self, html):
        """Detect web technologies from HTML signatures."""
        import re
        techs = []
        html_lower = (html or "").lower()

        tech_signatures = {
            "WordPress": ["/wp-content/", "/wp-includes/", "wp-json"],
            "Shopify": ["cdn.shopify.com", "shopify.com", "myshopify.com"],
            "Wix": ["static.wixstatic.com", "wix.com", "parastorage.com"],
            "Squarespace": ["squarespace.com", "sqsp.net", "static1.squarespace.com"],
            "React": ["react", "_next/static", "__next"],
            "Next.js": ["_next/", "__next", "next/"],
            "Vue.js": ["vue.js", "vue.min.js", "__vue__"],
            "Angular": ["ng-version", "angular.js", "angular.min.js"],
            "Bootstrap": ["bootstrap.min.css", "bootstrap.min.js", "bootstrap.css"],
            "Tailwind CSS": ["tailwindcss", "tailwind.min.css"],
            "jQuery": ["jquery.min.js", "jquery.js", "jquery-"],
            "Google Analytics": ["google-analytics.com", "gtag/", "ga.js", "analytics.js"],
            "Google Tag Manager": ["googletagmanager.com", "gtm.js"],
            "Facebook Pixel": ["connect.facebook.net", "fbevents.js", "fbq("],
            "Cloudflare": ["cloudflare", "cf-ray", "cdnjs.cloudflare.com"],
            "Stripe": ["js.stripe.com", "stripe.js"],
            "Intercom": ["intercom.io", "intercomcdn.com"],
            "HubSpot": ["hs-scripts.com", "hubspot.com", "hs-analytics"],
            "Mailchimp": ["mailchimp.com", "mc.us", "chimpstatic.com"],
            "Zendesk": ["zendesk.com", "zdassets.com", "zopim.com"],
            "Drift": ["drift.com", "js.driftt.com"],
            "LiveChat": ["livechat.com", "livechatinc.com"],
            "Freshdesk": ["freshdesk.com", "freshchat"],
            "Hotjar": ["hotjar.com", "static.hotjar.com"],
            "Crisp": ["crisp.chat", "client.crisp.chat"],
            "Tawk.to": ["tawk.to", "embed.tawk.to"],
            "Webflow": ["webflow.com", "assets-global.website-files.com"],
            "Ghost": ["ghost.io", "ghost.org"],
            "Magento": ["mage/", "magento", "varien/"],
            "PrestaShop": ["prestashop", "presta"],
            "Drupal": ["drupal.js", "drupal.org", "/sites/default/files/"],
            "Joomla": ["joomla", "/media/system/"],
        }

        for tech_name, signatures in tech_signatures.items():
            for sig in signatures:
                if sig.lower() in html_lower:
                    techs.append(tech_name)
                    break

        return techs

    def _extract_people_names(self, html, text):
        """Extract executive/people names from structured data and common patterns."""
        import re
        result = {"ceo": None, "coo": None, "cfo": None, "cto": None, "founder": None, "owner": None, "others": []}

        # Try schema.org JSON-LD for founder/employee
        for m in re.findall(r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html or "", re.I | re.S):
            try:
                data = json.loads(m)
                if isinstance(data, list):
                    data = data[0] if data else {}
                founder = data.get("founder")
                if isinstance(founder, dict):
                    result["founder"] = founder.get("name")
                elif isinstance(founder, str):
                    result["founder"] = founder
                # Check for employee/member
                for key in ("employee", "member", "author"):
                    person = data.get(key)
                    if isinstance(person, dict) and person.get("name"):
                        result["others"].append(person["name"])
                    elif isinstance(person, list):
                        for p in person[:5]:
                            if isinstance(p, dict) and p.get("name"):
                                result["others"].append(p["name"])
            except (json.JSONDecodeError, AttributeError, TypeError):
                pass

        # Scan text for role-name patterns: "CEO: John Smith", "founded by Jane Doe"
        role_patterns = [
            (r'(?:CEO|Chief\s+Executive\s+Officer)[:\s,–-]+([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)', "ceo"),
            (r'(?:COO|Chief\s+Operating\s+Officer)[:\s,–-]+([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)', "coo"),
            (r'(?:CFO|Chief\s+Financial\s+Officer)[:\s,–-]+([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)', "cfo"),
            (r'(?:CTO|Chief\s+Technology\s+Officer)[:\s,–-]+([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)', "cto"),
            (r'(?:[Ff]ounded?\s+by|[Ff]ounder)[:\s,–-]+([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)', "founder"),
            (r'(?:[Oo]wner|[Pp]roprietor)[:\s,–-]+([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)', "owner"),
            (r'(?:VP|Vice\s+President|Director|Managing\s+Director)(?:\s+(?:of|for)\s+\w+)?[:\s,–-]+([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)', "_vp"),
        ]

        combined_text = (text or "") + " " + BeautifulSoup(html or "", "html.parser").get_text(separator=" ")
        for pattern, role in role_patterns:
            match = re.search(pattern, combined_text)
            if match:
                name = match.group(1).strip()
                if len(name) > 3 and len(name) < 60:
                    if role == "_vp":
                        if name not in result["others"]:
                            result["others"].append(name)
                    elif not result.get(role):
                        result[role] = name

        return result

    def _compute_lead_score(self, has_email, has_phone, has_whatsapp, has_linkedin, social_count, has_address):
        """Compute a simple 0-100 lead quality score."""
        score = 0
        if has_email:
            score += 25
        if has_phone:
            score += 20
        if has_whatsapp:
            score += 10
        if has_linkedin:
            score += 15
        if has_address:
            score += 10
        # Social presence (up to 20 points)
        score += min(20, social_count * 5)
        return min(100, score)

    def _record_usage(self, provider, model, prompt_tokens, completion_tokens):
        # We will estimate cost in the frontend, just store the tokens here
        try:
            conn = get_connection(self.db_path)
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO enrichment_usage (provider, model, prompt_tokens, completion_tokens, created_at)
                VALUES (?, ?, ?, ?, datetime('now'))
            """,
                (provider, model, prompt_tokens, completion_tokens),
            )
            conn.commit()
            conn.close()
        except Exception as e:
            Communicator.show_message(f"Failed to record token usage: {e}")
