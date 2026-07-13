import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleApiError } from "@/lib/api-helper";
import { requireUser, isResponse, scopeClause } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (isResponse(auth)) return auth;
    const scope = scopeClause(auth);

    const stmt = db.prepare(`
      SELECT country, COUNT(*) as count
      FROM records
      WHERE ${scope} AND country IS NOT NULL AND country != ''
      GROUP BY country
      ORDER BY count DESC
      LIMIT 10
    `);
    const distribution = stmt.all();

    return NextResponse.json({ success: true, distribution });
  } catch (error) {
    return handleApiError(error);
  }
}
