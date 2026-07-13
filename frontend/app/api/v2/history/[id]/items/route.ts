import { NextRequest, NextResponse } from "next/server";
import { getJobItems } from "@/lib/models/jobs";
import { handleApiError } from "@/lib/api-helper";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const jobId = parseInt(id);
    const items = getJobItems(jobId);

    return NextResponse.json({ success: true, items });
  } catch (error) {
    return handleApiError(error);
  }
}
