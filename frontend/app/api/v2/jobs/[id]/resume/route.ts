/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { getJobById, resumeJobInDb } from "@/lib/models/jobs";
import { handleApiError } from "@/lib/api-helper";
import { requireUser, isResponse, SESSION_COOKIE } from "@/lib/auth";
import { cookies } from "next/headers";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireUser();
    if (isResponse(auth)) return auth;

    const { id } = await params;
    const jobId = parseInt(id);

    // 1. Fetch job details
    const job = getJobById(jobId);
    if (!job) {
      return NextResponse.json({ success: false, error: "Scrape job not found." }, { status: 404 });
    }

    // Ownership: a non-admin can only resume their own job.
    if (auth.role !== "admin" && (job as any).user_id !== auth.id) {
      return NextResponse.json({ success: false, error: "Not your job." }, { status: 403 });
    }

    if (job.status === "running") {
      return NextResponse.json({ success: false, error: "Job is already running." }, { status: 400 });
    }

    // 2. Reset job status to running in DB
    const updatedJob = resumeJobInDb(jobId);
    if (!updatedJob) {
      return NextResponse.json({ success: false, error: "Failed to resume job in database." }, { status: 500 });
    }

    // 3. Proxy resume call to Flask, forwarding the caller's session cookie.
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value ?? "";
    const flaskUrl = process.env.FLASK_API_URL || "http://localhost:5001";
    try {
      const res = await fetch(`${flaskUrl}/api/scrape`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `${SESSION_COOKIE}=${token}`,
        },
        body: JSON.stringify({
          query: job.query,
          format: job.format,
          headless: job.headless === 1,
          job_id: jobId,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        return NextResponse.json({ success: false, error: data.message || "Flask backend failed to resume." }, { status: res.status });
      }

      return NextResponse.json({ success: true, job: updatedJob });
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-unused-vars
      return NextResponse.json(
        { success: false, error: "Could not connect to the scraper backend. Please check if the backend server is running." },
        { status: 503 }
      );
    }
  } catch (error) {
    return handleApiError(error);
  }
}
