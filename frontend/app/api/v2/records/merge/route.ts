import { NextRequest, NextResponse } from "next/server";
import { mergeRecordsSmartly } from "@/lib/models/records";
import { handleApiError } from "@/lib/api-helper";
import { requireUser, isResponse } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (isResponse(auth)) return auth;

    const { targetId, sourceIds } = await req.json();
    if (!targetId || !Array.isArray(sourceIds) || sourceIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "targetId and non-empty sourceIds array are required" },
        { status: 400 }
      );
    }

    const merged = mergeRecordsSmartly(targetId, sourceIds, {
      userId: auth.id,
      isAdmin: auth.role === "admin",
    });

    return NextResponse.json({ success: true, record: merged });
  } catch (error) {
    return handleApiError(error);
  }
}
