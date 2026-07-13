/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "../db";
import crypto from "crypto";

export interface RecordInput {
  category?: string;
  name: string;
  phone?: string;
  google_maps_url?: string;
  website?: string;
  email?: string;
  business_status?: string;
  address?: string;
  total_reviews?: string;
  booking_links?: string;
  rating?: string;
  hours?: string;
  latitude?: number;
  longitude?: number;
  country?: string;
  city?: string;
  region?: string;
  source_query?: string;
  tags?: string; // JSON string e.g. '["tag1"]'
  is_favorite?: number;
  notes?: string;
}

export interface Record extends RecordInput {
  id: number;
  scraped_at: string;
  updated_at: string;
  dedup_hash: string;
}

export function computeDedupHash(name: string, address?: string, phone?: string): string {
  const normalizedName = (name || "").toLowerCase().trim();
  const normalizedAddress = (address || "").toLowerCase().trim();
  const normalizedPhone = (phone || "").trim();
  const rawString = `${normalizedName}|${normalizedAddress}|${normalizedPhone}`;
  return crypto.createHash("md5").update(rawString).digest("hex");
}

export function parseAddress(address?: string): { country: string | null; city: string | null; region: string | null } {
  if (!address) return { country: null, city: null, region: null };

  const parts = address.split(/,|\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { country: null, city: null, region: null };

  let country: string | null = null;
  let city: string | null = null;
  let region: string | null = null;

  // Last part is usually country
  const lastPart = parts[parts.length - 1];
  country = lastPart.replace(/\d+/g, "").trim();

  // If the last part was just a zip code or empty, look back
  if (!country && parts.length > 1) {
    const secondLast = parts[parts.length - 2];
    country = secondLast.replace(/\d+/g, "").trim();
  }

  // Parse state/region and city
  if (parts.length > 1) {
    const secondLast = parts[parts.length - 2];
    const words = secondLast.split(" ").filter(Boolean);
    if (words.length === 2 && words[0].length === 2 && /^[A-Z]{2}$/.test(words[0])) {
      region = words[0];
    } else {
      region = secondLast.replace(/\d+/g, "").trim();
    }
  }

  if (parts.length > 2) {
    const thirdLast = parts[parts.length - 3];
    city = thirdLast.replace(/\d+/g, "").trim();
  } else if (parts.length === 2) {
    city = parts[0].replace(/\d+/g, "").trim();
  }

  return {
    country: country || null,
    city: city || region || null,
    region: region || null,
  };
}

export function extractCoordinates(url?: string): { latitude: number | null; longitude: number | null } {
  if (!url) return { latitude: null, longitude: null };
  const match1 = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (match1) {
    return { latitude: parseFloat(match1[1]), longitude: parseFloat(match1[2]) };
  }
  const match2 = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (match2) {
    return { latitude: parseFloat(match2[1]), longitude: parseFloat(match2[2]) };
  }
  return { latitude: null, longitude: null };
}

export function upsertRecord(input: RecordInput): Record {
  const dedup_hash = computeDedupHash(input.name, input.address, input.phone);
  const tags = input.tags || "[]";
  const is_favorite = input.is_favorite ?? 0;
  const notes = input.notes || "";

  const parsed = parseAddress(input.address);
  const country = input.country || parsed.country;
  const city = input.city || parsed.city;
  const region = input.region || parsed.region;
  
  const coords = extractCoordinates(input.google_maps_url);
  const latitude = input.latitude ?? coords.latitude;
  const longitude = input.longitude ?? coords.longitude;

  const stmt = db.prepare(`
    INSERT INTO records (
      category, name, phone, google_maps_url, website, email,
      business_status, address, total_reviews, booking_links, rating, hours,
      latitude, longitude, country, city, region, source_query,
      tags, is_favorite, notes, dedup_hash, updated_at
    ) VALUES (
      @category, @name, @phone, @google_maps_url, @website, @email,
      @business_status, @address, @total_reviews, @booking_links, @rating, @hours,
      @latitude, @longitude, @country, @city, @region, @source_query,
      @tags, @is_favorite, @notes, @dedup_hash, datetime('now')
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
      updated_at = datetime('now')
    RETURNING *
  `);

  return stmt.get({
    category: input.category || null,
    name: input.name,
    phone: input.phone || null,
    google_maps_url: input.google_maps_url || null,
    website: input.website || null,
    email: input.email || null,
    business_status: input.business_status || null,
    address: input.address || null,
    total_reviews: input.total_reviews || null,
    booking_links: input.booking_links || null,
    rating: input.rating || null,
    hours: input.hours || null,
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    country: country || null,
    city: city || null,
    region: region || null,
    source_query: input.source_query || null,
    tags,
    is_favorite,
    notes,
    dedup_hash,
  }) as Record;
}


export function getRecordById(id: number): Record | undefined {
  return db.prepare("SELECT * FROM records WHERE id = ?").get(id) as Record | undefined;
}

export function updateRecord(id: number, updates: Partial<RecordInput>): Record | undefined {
  const keys = Object.keys(updates).filter((k) => k !== "id" && k !== "scraped_at" && k !== "dedup_hash");
  if (keys.length === 0) {
    return getRecordById(id);
  }

  const setClauses = keys.map((key) => `${key} = @${key}`);
  setClauses.push("updated_at = datetime('now')");

  const query = `
    UPDATE records
    SET ${setClauses.join(", ")}
    WHERE id = @id
    RETURNING *
  `;

  const stmt = db.prepare(query);
   
  const params: any = { id, ...updates };
  return stmt.get(params) as Record | undefined;
}

export function deleteRecord(id: number): boolean {
  const info = db.prepare("DELETE FROM records WHERE id = ?").run(id);
  return info.changes > 0;
}

export function bulkDeleteRecords(ids: number[]): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(",");
  const info = db.prepare(`DELETE FROM records WHERE id IN (${placeholders})`).run(...ids);
  return info.changes;
}

export interface ListRecordsOptions {
  page?: number;
  limit?: number;
  search?: string;
  filters?: {
    country?: string;
    city?: string;
    region?: string;
    category?: string;
    is_favorite?: number;
    has_email?: boolean;
    has_website?: boolean;
    has_phone?: boolean;
    min_rating?: number;
    min_reviews?: number;
    tag?: string;
    scraped_from?: string; // start date ISO string
    scraped_to?: string; // end date ISO string
    source_query?: string;
  };
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  // Multi-tenant scope: restrict to a user's own records. Admins pass isAdmin.
  scope?: { userId: number; isAdmin: boolean };
}

export function listRecords(options: ListRecordsOptions = {}) {
  const page = options.page || 1;
  const limit = options.limit || 50;
  const offset = (page - 1) * limit;
  const sortBy = options.sortBy || "id";
  const sortOrder = options.sortOrder || "desc";

  const conditions: string[] = [];

  const params: any = {};

  // Tenant isolation: non-admins only see their own records.
  if (options.scope && !options.scope.isAdmin) {
    conditions.push("records.user_id = @scopeUserId");
    params.scopeUserId = options.scope.userId;
  }

  // Handle Full-Text Search
  if (options.search) {
    // Escaping special characters for SQLite FTS5 Match
    const cleanSearch = options.search.replace(/[^a-zA-Z0-9\s]/g, " ");
    if (cleanSearch.trim()) {
      conditions.push(`records.id IN (SELECT rowid FROM records_fts WHERE records_fts MATCH @searchText)`);
      params.searchText = `"${cleanSearch.trim()}"`;
    }
  }

  // Handle Filters
  if (options.filters) {
    const f = options.filters;
    if (f.country) {
      conditions.push("records.country = @country");
      params.country = f.country;
    }
    if (f.city) {
      conditions.push("records.city = @city");
      params.city = f.city;
    }
    if (f.region) {
      conditions.push("records.region = @region");
      params.region = f.region;
    }
    if (f.category) {
      conditions.push("records.category = @category");
      params.category = f.category;
    }
    if (f.is_favorite !== undefined) {
      conditions.push("records.is_favorite = @isFavorite");
      params.isFavorite = f.is_favorite;
    }
    if (f.has_email !== undefined) {
      if (f.has_email) {
        conditions.push("records.email IS NOT NULL AND records.email != ''");
      } else {
        conditions.push("(records.email IS NULL OR records.email = '')");
      }
    }
    if (f.has_website !== undefined) {
      if (f.has_website) {
        conditions.push("records.website IS NOT NULL AND records.website != ''");
      } else {
        conditions.push("(records.website IS NULL OR records.website = '')");
      }
    }
    if (f.has_phone !== undefined) {
      if (f.has_phone) {
        conditions.push("records.phone IS NOT NULL AND records.phone != ''");
      } else {
        conditions.push("(records.phone IS NULL OR records.phone = '')");
      }
    }
    if (f.min_rating !== undefined) {
      conditions.push("CAST(records.rating AS REAL) >= @minRating");
      params.minRating = f.min_rating;
    }
    if (f.min_reviews !== undefined) {
      // Extract numeric part from reviews e.g. (67,295) -> 67295
      // SQLite does not have regex replace natively, so we cast if we can,
      // but in SQLite we can do a numeric cast after cleaning in the app or
      // clean it at insertion time. Let's do CAST(REPLACE(REPLACE(total_reviews, ',', ''), '(', '') AS INTEGER)
      conditions.push("CAST(REPLACE(REPLACE(REPLACE(records.total_reviews, ',', ''), '(', ''), ')', '') AS INTEGER) >= @minReviews");
      params.minReviews = f.min_reviews;
    }
    if (f.tag) {
      conditions.push("records.tags LIKE @tagText");
      params.tagText = `%\"${f.tag}\"%`;
    }
    if (f.scraped_from) {
      conditions.push("datetime(records.scraped_at) >= datetime(@scrapedFrom)");
      params.scrapedFrom = f.scraped_from;
    }
    if (f.scraped_to) {
      conditions.push("datetime(records.scraped_at) <= datetime(@scrapedTo)");
      params.scrapedTo = f.scraped_to;
    }
    if (f.source_query) {
      conditions.push("records.source_query = @sourceQuery");
      params.sourceQuery = f.source_query;
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Verify sort column is safe to prevent SQL injection
  const allowedSortColumns = [
    "id",
    "category",
    "name",
    "phone",
    "google_maps_url",
    "website",
    "email",
    "business_status",
    "address",
    "total_reviews",
    "rating",
    "scraped_at",
    "updated_at",
    "is_favorite",
  ];
  const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : "id";
  const safeSortOrder = sortOrder === "asc" ? "ASC" : "DESC";

  // If sorting by rating or reviews, we should cast to numeric values so sorting works correctly
  let orderByClause = `ORDER BY records.${safeSortBy} ${safeSortOrder}`;
  if (safeSortBy === "rating") {
    orderByClause = `ORDER BY CASE WHEN records.rating IS NULL OR records.rating = '' THEN 0 ELSE CAST(records.rating AS REAL) END ${safeSortOrder}`;
  } else if (safeSortBy === "total_reviews") {
    orderByClause = `ORDER BY CASE WHEN records.total_reviews IS NULL OR records.total_reviews = '' THEN 0 ELSE CAST(REPLACE(REPLACE(REPLACE(records.total_reviews, ',', ''), '(', ''), ')', '') AS INTEGER) END ${safeSortOrder}`;
  }

  const listQuery = `
    SELECT records.* FROM records
    ${whereClause}
    ${orderByClause}
    LIMIT @limit OFFSET @offset
  `;

  const countQuery = `
    SELECT COUNT(*) as count FROM records
    ${whereClause}
  `;

  const listStmt = db.prepare(listQuery);
  const countStmt = db.prepare(countQuery);

  const queryParams = { ...params, limit, offset };
  const records = listStmt.all(queryParams) as Record[];
  const total = (countStmt.get(params) as any).count as number;

  return {
    records,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export function getAllUniqueValues(column: "country" | "city" | "region" | "category" | "source_query"): string[] {
  const allowedColumns = ["country", "city", "region", "category", "source_query"];
  if (!allowedColumns.includes(column)) {
    throw new Error(`Invalid column: ${column}`);
  }

  const stmt = db.prepare(`
    SELECT DISTINCT ${column} as val
    FROM records
    WHERE ${column} IS NOT NULL AND ${column} != ''
    ORDER BY ${column} ASC
  `);

   
  return stmt.all().map((r: any) => r.val as string);
}

export function findPotentialDuplicates(scope: { userId: number; isAdmin: boolean }) {
  const conditions = [];
  const params: any = {};
  if (!scope.isAdmin) {
    conditions.push("user_id = @userId");
    params.userId = scope.userId;
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Identify duplicate categories: records with identical non-empty website, phone, email, or name
  const query = `
    WITH DuplicateWebsites AS (
      SELECT website FROM records
      ${whereClause}
      AND website IS NOT NULL AND website != ''
      GROUP BY website HAVING COUNT(*) > 1
    ),
    DuplicatePhones AS (
      SELECT phone FROM records
      ${whereClause}
      AND phone IS NOT NULL AND phone != ''
      GROUP BY phone HAVING COUNT(*) > 1
    ),
    DuplicateEmails AS (
      SELECT email FROM records
      ${whereClause}
      AND email IS NOT NULL AND email != ''
      GROUP BY email HAVING COUNT(*) > 1
    ),
    DuplicateNames AS (
      SELECT LOWER(TRIM(name)) as norm_name FROM records
      ${whereClause}
      GROUP BY LOWER(TRIM(name)) HAVING COUNT(*) > 1
    )
    SELECT * FROM records
    ${whereClause ? whereClause + ' AND' : 'WHERE'} (
      website IN (SELECT website FROM DuplicateWebsites)
      OR phone IN (SELECT phone FROM DuplicatePhones)
      OR email IN (SELECT email FROM DuplicateEmails)
      OR LOWER(TRIM(name)) IN (SELECT norm_name FROM DuplicateNames)
    )
    ORDER BY name ASC, id DESC
  `;

  const stmt = db.prepare(query);
  const rows = stmt.all(params) as Record[];

  // Cluster the matches into potential duplicate groups
  const clusters: Record[][] = [];
  for (const row of rows) {
    let matchedCluster = null;
    const normName = (row.name || "").toLowerCase().trim();
    const normWebsite = (row.website || "").toLowerCase().trim();
    const normPhone = (row.phone || "").replace(/\D/g, "");
    const normEmail = (row.email || "").toLowerCase().trim();

    for (const cluster of clusters) {
      const isMatch = cluster.some(c => {
        const cName = (c.name || "").toLowerCase().trim();
        const cWebsite = (c.website || "").toLowerCase().trim();
        const cPhone = (c.phone || "").replace(/\D/g, "");
        const cEmail = (c.email || "").toLowerCase().trim();

        return (
          (normName && cName === normName) ||
          (normWebsite && cWebsite === normWebsite) ||
          (normPhone && cPhone && cPhone === normPhone) ||
          (normEmail && cEmail && cEmail === normEmail)
        );
      });
      if (isMatch) {
        matchedCluster = cluster;
        break;
      }
    }

    if (matchedCluster) {
      matchedCluster.push(row);
    } else {
      clusters.push([row]);
    }
  }

  return clusters.filter(c => c.length > 1);
}

export function mergeRecordsSmartly(
  targetId: number,
  sourceIds: number[],
  scope: { userId: number; isAdmin: boolean }
): Record {
  const target = getRecordById(targetId);
  if (!target) {
    throw new Error("Target record not found");
  }
  if (!scope.isAdmin && target.user_id !== scope.userId) {
    throw new Error("Not authorized to modify this record");
  }

  const sources: Record[] = [];
  for (const srcId of sourceIds) {
    const src = getRecordById(srcId);
    if (!src) {
      throw new Error(`Source record ${srcId} not found`);
    }
    if (!scope.isAdmin && src.user_id !== scope.userId) {
      throw new Error(`Not authorized to modify record ${srcId}`);
    }
    sources.push(src);
  }

  const mergedFields: any = { ...target };

  // Concat notes
  let notes = target.notes || "";
  for (const src of sources) {
    if (src.notes && src.notes.trim()) {
      notes = notes ? `${notes}\n\n${src.notes}` : src.notes;
    }
  }
  mergedFields.notes = notes;

  // List fields to union
  const listKeys = [
    { key: "social_profiles", split: "," },
    { key: "executives", split: "," },
    { key: "emails", split: "," },
    { key: "phones", split: "," },
    { key: "whatsapp", split: "," },
    { key: "technologies", split: "," }
  ];
  for (const { key, split } of listKeys) {
    const vals = new Set<string>();
    if (target[key]) {
      target[key].split(split).map((s: string) => s.trim()).filter(Boolean).forEach((s: string) => vals.add(s));
    }
    for (const src of sources) {
      if (src[key]) {
        src[key].split(split).map((s: string) => s.trim()).filter(Boolean).forEach((s: string) => vals.add(s));
      }
    }
    mergedFields[key] = vals.size > 0 ? Array.from(vals).join(split) : null;
  }

  // JSON arrays to union
  const jsonArrayKeys = ["tags", "web_emails", "web_phones", "web_whatsapp", "web_tech"];
  for (const key of jsonArrayKeys) {
    const vals = new Set<string>();
    try {
      if (target[key]) {
        const arr = JSON.parse(target[key]);
        if (Array.isArray(arr)) arr.forEach(x => vals.add(String(x)));
      }
    } catch (e) {}
    for (const src of sources) {
      try {
        if (src[key]) {
          const arr = JSON.parse(src[key]);
          if (Array.isArray(arr)) arr.forEach(x => vals.add(String(x)));
        }
      } catch (e) {}
    }
    mergedFields[key] = JSON.stringify(Array.from(vals));
  }

  // JSON Object to merge: web_socials
  let targetSocials = {};
  try {
    if (target.web_socials) {
      targetSocials = JSON.parse(target.web_socials);
    }
  } catch (e) {}
  for (const src of sources) {
    try {
      if (src.web_socials) {
        const srcSocials = JSON.parse(src.web_socials);
        Object.assign(targetSocials, srcSocials);
      }
    } catch (e) {}
  }
  mergedFields.web_socials = JSON.stringify(targetSocials);

  // Simple key value fallback (if target has none, grab first non-empty from sources)
  const keysToMerge = [
    "category", "phone", "email", "website", "google_maps_url",
    "business_status", "address", "total_reviews", "booking_links",
    "rating", "hours", "latitude", "longitude", "country", "city",
    "region", "source_query", "enriched_company_info", "social_profiles",
    "owner_name", "ceo_name", "coo_name", "executives", "linkedin_url",
    "email_primary", "phone_primary", "website_title", "website_description",
    "business_hours"
  ];
  for (const key of keysToMerge) {
    if (!listKeys.some(l => l.key === key) && !jsonArrayKeys.includes(key) && key !== "web_socials") {
      if (mergedFields[key] === undefined || mergedFields[key] === null || mergedFields[key] === "") {
        for (const src of sources) {
          if (src[key] !== undefined && src[key] !== null && src[key] !== "") {
            mergedFields[key] = src[key];
            break;
          }
        }
      }
    }
  }

  // Favorite flag
  mergedFields.is_favorite = Math.max(target.is_favorite || 0, ...sources.map(s => s.is_favorite || 0));

  // Lead score and grade
  mergedFields.lead_score = Math.max(target.lead_score || 0, ...sources.map(s => s.lead_score || 0));
  mergedFields.lead_grade = mergedFields.lead_score >= 80 ? "A" : mergedFields.lead_score >= 60 ? "B" : mergedFields.lead_score >= 40 ? "C" : "D";

  // Perform Update on Target
  const updateResult = updateRecord(targetId, mergedFields);
  if (!updateResult) {
    throw new Error("Failed to update target record during merge");
  }

  // Delete all source duplicate records
  for (const srcId of sourceIds) {
    deleteRecord(srcId);
  }

  return updateResult;
}
