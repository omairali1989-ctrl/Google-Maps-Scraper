import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleApiError } from "@/lib/api-helper";
import fs from "fs";
import path from "path";

export async function GET(req: NextRequest) {
  try {
    const dbPath = path.join(process.cwd(), "data", "extractrx.db");
    let sizeBytes = 0;
    try {
      if (fs.existsSync(dbPath)) {
        const stats = fs.statSync(dbPath);
        sizeBytes = stats.size;
      }
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
    }
    const recordsCount = (db.prepare("SELECT COUNT(*) as count FROM records").get() as any).count;
    const jobsCount = (db.prepare("SELECT COUNT(*) as count FROM scrape_jobs").get() as any).count;
    const exportsCount = (db.prepare("SELECT COUNT(*) as count FROM export_history").get() as any).count;

    return NextResponse.json({
      success: true,
      stats: {
        sizeBytes,
        recordsCount,
        jobsCount,
        exportsCount,
        path: dbPath,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

 
export async function POST(req: NextRequest) {
  try {
    const { action } = await req.json();

    if (!action) {
      return NextResponse.json({ success: false, error: "Action is required." }, { status: 400 });
    }

    if (action === "vacuum") {
      db.exec("VACUUM");
      return NextResponse.json({ success: true, message: "Database optimized successfully." });
    }

    if (action === "clear_records") {
      db.exec("DELETE FROM records");
      db.exec("DELETE FROM records_fts");
      db.exec("VACUUM");
      return NextResponse.json({ success: true, message: "All business records cleared." });
    }

    if (action === "clear_history") {
      db.exec("DELETE FROM scrape_jobs");
      db.exec("DELETE FROM export_history");
      db.exec("VACUUM");
      return NextResponse.json({ success: true, message: "All logs and export history cleared." });
    }

    if (action === "reset") {
      db.exec("DELETE FROM records");
      db.exec("DELETE FROM records_fts");
      db.exec("DELETE FROM scrape_jobs");
      db.exec("DELETE FROM export_history");
      db.exec("DELETE FROM saved_filters");
      db.exec("VACUUM");
      return NextResponse.json({ success: true, message: "Application database reset completely." });
    }

    return NextResponse.json({ success: false, error: `Invalid action: ${action}` }, { status: 400 });
  } catch (error) {
    return handleApiError(error);
  }
}
