import { NextRequest, NextResponse } from "next/server";
import { updateJobStatus } from "@/lib/models/jobs";
import { handleApiError } from "@/lib/api-helper";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const jobId = parseInt(id);
    const body = await req.json();
    const { status, recordCount, errorMessage } = body;

    const updated = updateJobStatus(jobId, status, recordCount, errorMessage);
    if (!updated) {
      return NextResponse.json({ success: false, error: "Scrape job not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true, job: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
