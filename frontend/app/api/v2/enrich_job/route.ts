import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireUser, isResponse, SESSION_COOKIE } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const auth = await requireUser();
    if (isResponse(auth)) return auth;

    const body = await req.json();
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value ?? '';
    const flaskUrl = process.env.FLASK_API_URL || "http://localhost:5001";
    const res = await fetch(`${flaskUrl}/api/v2/enrich_job`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE}=${token}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json({ success: false, message: 'Failed to trigger enrichment' }, { status: 500 });
  }
}
