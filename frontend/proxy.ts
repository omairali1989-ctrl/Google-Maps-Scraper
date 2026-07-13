import { NextRequest, NextResponse } from "next/server";

/**
 * Blanket authentication gate.
 *
 * Every /api/v2/* route (except the auth endpoints) and every dashboard page
 * requires a session cookie. This is a coarse "is there a session?" check —
 * per-user data scoping and RBAC still happen in each route/model, but this
 * guarantees no data endpoint is reachable without authentication even if a
 * route forgets its own check. Cookie validity is fully verified server-side
 * in lib/auth.ts (against the sessions table); middleware only checks presence
 * because the Edge runtime can't open SQLite.
 */

const SESSION_COOKIE = "gms_session";

// Endpoints reachable without a session.
const PUBLIC_API = [
  "/api/v2/auth/login",
  "/api/v2/auth/logout",
];

// Pages reachable without a session.
const PUBLIC_PAGES = ["/login"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  // API routes
  if (pathname.startsWith("/api/")) {
    // The scrape control + observability endpoints are proxied to Flask, which
    // does its own auth; but we still require a session cookie to reach them.
    if (PUBLIC_API.some((p) => pathname.startsWith(p))) {
      return NextResponse.next();
    }
    if (!hasSession) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    return NextResponse.next();
  }

  // Page routes: redirect unauthenticated users to /login.
  if (PUBLIC_PAGES.some((p) => pathname.startsWith(p))) {
    // Already-authenticated users don't need the login page.
    if (hasSession && pathname === "/login") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on all app + api routes except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico)).*)"],
};
