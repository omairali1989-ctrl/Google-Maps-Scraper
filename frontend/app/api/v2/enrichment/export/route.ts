import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireUser, isResponse, SESSION_COOKIE } from '@/lib/auth';

// Stream the enriched-leads export (CSV or JSON) straight from Flask.
export async function GET(req: Request) {
  try {
    const auth = await requireUser();
    if (isResponse(auth)) return auth;

    const { searchParams } = new URL(req.url);
    const format = searchParams.get('format') || 'csv';
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value ?? '';
    const flaskUrl = process.env.FLASK_API_URL || 'http://localhost:5001';
    const res = await fetch(
      `${flaskUrl}/api/v2/enrichment/export?format=${encodeURIComponent(format)}`,
      { method: 'GET', headers: { cookie: `${SESSION_COOKIE}=${token}` } },
    );
    if (format === 'json') {
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    }
    // CSV: pass the body + content-disposition through unchanged.
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition':
          res.headers.get('content-disposition') ||
          'attachment; filename=enriched_leads.csv',
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'Failed to export enriched leads' },
      { status: 500 },
    );
  }
}
