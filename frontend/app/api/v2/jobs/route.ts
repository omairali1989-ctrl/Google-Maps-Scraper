import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { cookies } from 'next/headers';
import { requireUser, isResponse, SESSION_COOKIE } from '@/lib/auth';

export async function GET() {
  try {
    const auth = await requireUser();
    if (isResponse(auth)) return auth;
    // Proxy to Flask with the caller's session so it scopes to this user.
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value ?? '';
    const flaskUrl = process.env.FLASK_API_URL || "http://localhost:5001";
    const res = await fetch(`${flaskUrl}/api/v2/jobs`, {
      cache: 'no-store',
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (isResponse(auth)) return auth;

    const body = await req.json();
    const { query, format, headless, enable_enrichment, enrichment_model, skip_previously_scraped } = body;

    if (!query) {
      return NextResponse.json({ success: false, message: 'Query is required' }, { status: 400 });
    }

    // 1. Insert the job owned by the authenticated user.
    const stmt = db.prepare(`
      INSERT INTO scrape_jobs (query, format, headless, status, user_id)
      VALUES (?, ?, ?, 'running', ?)
    `);
    const info = stmt.run(query, format || 'excel', headless ? 1 : 0, auth.id);
    const job_id = info.lastInsertRowid.toString();

    // 2. Call the Python backend, forwarding the session cookie so its auth
    //    (added for multi-tenancy) accepts the request and re-confirms ownership.
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value ?? '';
    const flaskUrl = process.env.FLASK_API_URL || "http://localhost:5001";
    const res = await fetch(`${flaskUrl}/api/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE}=${token}`,
      },
      body: JSON.stringify({
        query,
        format: format || 'excel',
        headless: !!headless,
        job_id,
        enable_enrichment: !!enable_enrichment,
        enrichment_model: enrichment_model || 'openrouter|google/gemini-2.5-flash',
        skip_previously_scraped: !!skip_previously_scraped
      })
    });
    
    const data = await res.json();
    if (res.ok && data.success) {
      return NextResponse.json({ success: true, job_id, message: data.message });
    } else {
      // If failed, mark as failed in db
      db.prepare(`UPDATE scrape_jobs SET status = 'failed', error_message = ? WHERE id = ?`).run(data.message || 'Failed to start', job_id);
      return NextResponse.json({ success: false, message: data.message || 'Failed to start scraping' }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message || 'Internal Server Error' }, { status: 500 });
  }
}
