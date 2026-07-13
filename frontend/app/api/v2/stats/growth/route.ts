import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleApiError } from "@/lib/api-helper";
import { format, subDays, eachDayOfInterval } from "date-fns";
import { requireUser, isResponse, scopeClause } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (isResponse(auth)) return auth;
    const scope = scopeClause(auth);

    // 1. Get daily counts for last 30 days (scoped to the caller)
    const rows = db
      .prepare(
        `
      SELECT strftime('%Y-%m-%d', scraped_at) as date, COUNT(*) as count
      FROM records
      WHERE ${scope} AND datetime(scraped_at) >= datetime('now', '-30 days')
      GROUP BY date
      ORDER BY date ASC
    `
      )
      .all() as { date: string; count: number }[];

    // 2. Get the baseline (total count before 30 days ago)
    const baseCountRow = db
      .prepare(
        `
      SELECT COUNT(*) as count
      FROM records
      WHERE ${scope} AND datetime(scraped_at) < datetime('now', '-30 days')
    `
      )
      .get() as { count: number };
    let cumulativeSum = baseCountRow?.count || 0;

    // 3. Generate last 30 days interval
    const today = new Date();
    const startDate = subDays(today, 30);
    const dateInterval = eachDayOfInterval({ start: startDate, end: today });

    const dailyCountsMap = new Map<string, number>();
    rows.forEach((r) => {
      if (r.date) {
        dailyCountsMap.set(r.date, r.count);
      }
    });

    const data = dateInterval.map((d) => {
      const formattedDate = format(d, "yyyy-MM-dd");
      const dayCount = dailyCountsMap.get(formattedDate) || 0;
      cumulativeSum += dayCount;
      return {
        date: format(d, "MMM dd"),
        records: cumulativeSum,
        added: dayCount,
      };
    });

    return NextResponse.json({ success: true, growth: data });
  } catch (error) {
    return handleApiError(error);
  }
}
