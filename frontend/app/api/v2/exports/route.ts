import { NextRequest, NextResponse } from "next/server";
import { logExport, listExportHistory } from "@/lib/models/exports";
import { handleApiError } from "@/lib/api-helper";

export async function GET(req: NextRequest) {
  try {
    const exports = listExportHistory();
    return NextResponse.json({ success: true, exports });
  } catch (error) {
    return handleApiError(error);
  }
}

 
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { filename, format, recordCount, filterApplied, fileSizeBytes } = body;

    if (!filename) {
      return NextResponse.json({ success: false, error: "A filename is required." }, { status: 400 });
    }
    if (!format) {
      return NextResponse.json({ success: false, error: "An export format is required." }, { status: 400 });
    }

    const item = logExport({
      filename,
      format,
      record_count: recordCount || 0,
      filter_applied: typeof filterApplied === "string" ? filterApplied : JSON.stringify(filterApplied),
      file_size_bytes: fileSizeBytes || 0,
    });

    return NextResponse.json({ success: true, export: item });
  } catch (error) {
    return handleApiError(error);
  }
}
