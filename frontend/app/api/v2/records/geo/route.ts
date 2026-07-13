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
      SELECT id, name, category, address, phone, website, email, rating, total_reviews, latitude, longitude
      FROM records
      WHERE ${scope} AND latitude IS NOT NULL AND longitude IS NOT NULL
    `);
    const records = stmt.all();
    return NextResponse.json({ success: true, records });
  } catch (error) {
    return handleApiError(error);
  }
}
