/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleApiError } from "@/lib/api-helper";
import { requireUser, isResponse, scopeClause } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (isResponse(auth)) return auth;
    const scope = scopeClause(auth); // records/jobs are scoped to the caller

    // 1. Total Records
    const totalRecords = (
      db.prepare(`SELECT COUNT(*) as count FROM records WHERE ${scope}`).get() as any
    ).count;

    // 2. Added Today (UTC or start of day)
    const addedToday = (
      db
        .prepare(
          `SELECT COUNT(*) as count FROM records WHERE ${scope} AND datetime(scraped_at) >= datetime('now', 'start of day')`
        )
        .get() as any
    ).count;

    // 3. Added This Week (last 7 days)
    const addedThisWeek = (
      db
        .prepare(
          `SELECT COUNT(*) as count FROM records WHERE ${scope} AND datetime(scraped_at) >= datetime('now', '-7 days')`
        )
        .get() as any
    ).count;

    // 4. Average Rating
    const avgRatingRaw = (
      db
        .prepare(
          `SELECT AVG(CAST(rating AS REAL)) as avg FROM records WHERE ${scope} AND rating IS NOT NULL AND rating != '' AND rating != 'None'`
        )
        .get() as any
    ).avg;
    const avgRating = avgRatingRaw ? Math.round(avgRatingRaw * 10) / 10 : 0; // round to 1 decimal place

    // 5. Total Emails
    const totalEmails = (
      db
        .prepare(
          `SELECT COUNT(*) as count FROM records WHERE ${scope} AND email IS NOT NULL AND email != ''`
        )
        .get() as any
    ).count;

    // 6. Active Jobs (Database check + Flask poll fallback)
    let activeJobs = 0;
    try {
      const activeInDb = (
        db
          .prepare(`SELECT COUNT(*) as count FROM scrape_jobs WHERE status = 'running' AND ${scope}`)
          .get() as any
      ).count;
      activeJobs = activeInDb > 0 ? 1 : 0;
    } catch (e) {
      // ignore db error
    }

    // (Removed a redundant unauthenticated /api/status poll — the scoped DB
    // query above already determines the user's active-jobs state.)

    return NextResponse.json({
      success: true,
      stats: {
        totalRecords,
        addedToday,
        addedThisWeek,
        avgRating,
        totalEmails,
        activeJobs,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
