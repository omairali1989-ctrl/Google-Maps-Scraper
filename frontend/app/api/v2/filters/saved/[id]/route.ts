import { NextRequest, NextResponse } from "next/server";
import { deleteSavedFilter } from "@/lib/models/filters";
import { handleApiError } from "@/lib/api-helper";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const filterId = parseInt(id);
    const success = deleteSavedFilter(filterId);
    if (!success) {
      return NextResponse.json({ success: false, error: "Saved filter not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
