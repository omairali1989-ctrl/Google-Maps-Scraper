import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleApiError } from "@/lib/api-helper";
import { requireUser, isResponse, scopeClause } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (isResponse(auth)) return auth;
    const scope = scopeClause(auth);

    // 1. Get categories ordered by count (scoped to the caller)
    const rows = db
      .prepare(
        `
      SELECT category, COUNT(*) as count
      FROM records
      WHERE ${scope} AND category IS NOT NULL AND category != ''
      GROUP BY category
      ORDER BY count DESC
    `
      )
      .all() as { category: string; count: number }[];

    // 2. Separate into top 8 and "Other"
    const top8 = rows.slice(0, 8);
    const otherRows = rows.slice(8);

    const otherCount = otherRows.reduce((sum, r) => sum + r.count, 0);

    const distribution = [...top8];
    if (otherCount > 0) {
      distribution.push({ category: "Other", count: otherCount });
    }

    return NextResponse.json({ success: true, distribution });
  } catch (error) {
    return handleApiError(error);
  }
}
