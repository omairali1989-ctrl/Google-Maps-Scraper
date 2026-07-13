import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireUser, isResponse, SESSION_COOKIE } from '@/lib/auth';

// Kick off a website (non-AI) enrichment batch. Forwards to the Flask backend,
// which owns the queue/worker. Auth is enforced here AND re-checked in Flask.
export async function POST(req: Request) {
  try {
    const auth = await requireUser();
    if (isResponse(auth)) return auth;

    const body = await req.json().catch(() => ({}));
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value ?? '';
    const flaskUrl = process.env.FLASK_API_URL || 'http://localhost:5001';
    const res = await fetch(`${flaskUrl}/api/v2/enrichment/start`, {
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
    return NextResponse.json(
      { success: false, message: 'Failed to start website enrichment' },
      { status: 500 },
    );
  }
}
