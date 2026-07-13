import { NextRequest, NextResponse } from "next/server";
import { listJobsFiltered, countJobsByStatus } from "@/lib/models/jobs";
import { handleApiError } from "@/lib/api-helper";
import { requireUser, isResponse } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (isResponse(auth)) return auth;
    const scope = { userId: auth.id, isAdmin: auth.role === "admin" };

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "all";
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");
    const search = searchParams.get("search") || undefined;

    const { jobs, total } = listJobsFiltered(status, limit, offset, search, scope);
    const counts = countJobsByStatus(scope);

    return NextResponse.json({
      success: true,
      jobs,
      total,
      counts,
      limit,
      offset,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
