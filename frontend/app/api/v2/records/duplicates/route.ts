import { NextRequest, NextResponse } from "next/server";
import { findPotentialDuplicates } from "@/lib/models/records";
import { handleApiError } from "@/lib/api-helper";
import { requireUser, isResponse } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (isResponse(auth)) return auth;

    const duplicates = findPotentialDuplicates({
      userId: auth.id,
      isAdmin: auth.role === "admin",
    });

    return NextResponse.json({ success: true, duplicates });
  } catch (error) {
    return handleApiError(error);
  }
}
