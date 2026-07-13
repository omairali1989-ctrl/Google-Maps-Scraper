import { NextRequest, NextResponse } from "next/server";
import { saveFilter, listSavedFilters } from "@/lib/models/filters";
import { handleApiError } from "@/lib/api-helper";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(req: NextRequest) {
  try {
    const filters = listSavedFilters();
    return NextResponse.json({ success: true, filters });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name, filterJson } = await req.json();
    if (!name || !name.trim()) {
      return NextResponse.json({ success: false, error: "A filter name is required." }, { status: 400 });
    }
    if (!filterJson) {
      return NextResponse.json({ success: false, error: "Filter criteria is required." }, { status: 400 });
    }

    const filterString = typeof filterJson === "string" ? filterJson : JSON.stringify(filterJson);
    const filter = saveFilter(name.trim(), filterString);
    return NextResponse.json({ success: true, filter });
  } catch (error) {
    return handleApiError(error);
  }
}
