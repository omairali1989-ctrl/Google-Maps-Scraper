import { NextRequest, NextResponse } from "next/server";
import { bulkDeleteRecords } from "@/lib/models/records";
import { handleApiError } from "@/lib/api-helper";

export async function POST(req: NextRequest) {
  try {
    const { ids } = await req.json();
    if (!Array.isArray(ids)) {
      return NextResponse.json(
        { success: false, error: "Please provide a valid array of record IDs to delete." },
        { status: 400 }
      );
    }

    const count = bulkDeleteRecords(ids);
    return NextResponse.json({ success: true, deletedCount: count });
  } catch (error) {
    return handleApiError(error);
  }
}
