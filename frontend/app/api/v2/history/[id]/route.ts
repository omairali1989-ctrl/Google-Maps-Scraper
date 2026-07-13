import { NextRequest, NextResponse } from "next/server";
import { getJobById, deleteJob } from "@/lib/models/jobs";
import { handleApiError } from "@/lib/api-helper";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const jobId = parseInt(id);
    const job = getJobById(jobId);

    if (!job) {
      return NextResponse.json(
        { success: false, error: "Job not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, job });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const jobId = parseInt(id);
    const deleted = deleteJob(jobId);

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Job not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
