import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "./db";

export const SESSION_COOKIE = "gms_session";

export interface AuthUser {
  id: number;
  username: string;
  email: string | null;
  role: "admin" | "user";
}

/**
 * Resolve the authenticated user from the session cookie by validating it
 * against the same `sessions` table the Python backend writes. Returns null
 * if there's no valid, unexpired session.
 *
 * This is the enforcement point for the Next.js tier — every data route must
 * call requireUser()/requireAdmin() and scope its queries by the user's id.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT u.id, u.username, u.email, u.role, u.is_active
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`
    )
    .get(token) as
    | { id: number; username: string; email: string | null; role: string; is_active: number }
    | undefined;

  if (!row || !row.is_active) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role === "admin" ? "admin" : "user",
  };
}

/** Thrown-style guard: returns the user or a 401 NextResponse. */
export async function requireUser(): Promise<AuthUser | NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  return user;
}

export async function requireAdmin(): Promise<AuthUser | NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  }
  return user;
}

export function isResponse(x: AuthUser | NextResponse): x is NextResponse {
  return x instanceof NextResponse;
}

/**
 * SQL scope clause for a given column so a query only returns the user's rows.
 * Admins get "1=1" (see everything). Returns a clause using a literal integer
 * id (safe: derived from a validated session, never user input).
 */
export function scopeClause(user: AuthUser, column = "user_id"): string {
  if (user.role === "admin") return "1=1";
  return `${column} = ${user.id}`;
}
