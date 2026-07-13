import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireUser, isResponse, SESSION_COOKIE } from '@/lib/auth';

// Poll website-enrichment job progress. Optional ?enrichment_job_id=<id> for a
// single job; otherwise returns the caller's recent jobs.
export async function GET(req: Request) {
  try {
    const auth = await requireUser();
    if (isResponse(auth)) return auth;

    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('enrichment_job_id');
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value ?? '';
    const flaskUrl = process.env.FLASK_API_URL || 'http://localhost:5001';
    const qs = jobId ? `?enrichment_job_id=${encodeURIComponent(jobId)}` : '';
    const res = await fetch(`${flaskUrl}/api/v2/enrichment/status${qs}`, {
      method: 'GET',
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { error: 'Failed to fetch enrichment status' },
      { status: 500 },
    );
  }
}
