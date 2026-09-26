import { NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rateLimit";
import { readCookie } from "@/lib/cookies";
import {
  verifyPending2faToken,
  createAdminSessionToken,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  ADMIN_PENDING_2FA_COOKIE,
} from "@/lib/adminAuth";
import { verifyTotp } from "@/lib/totp";
import { logSecurityEvent } from "@/lib/securityLog";

// Step 2 of admin login (only reached when ADMIN_TOTP_SECRET is set): the
// password was already correct (proven by the pending-2FA cookie) — this
// checks the 6-digit authenticator code and, only then, issues the real
// session. Rate-limited on its own so guessing the 6-digit code is no
// easier than guessing the password itself.
export async function POST(req: Request) {
  const ip = getClientIp(req);

  const attempt = await rateLimit(`admin-2fa:${ip}`, 5, 15 * 60_000);
  if (!attempt.success) {
    logSecurityEvent("admin_login_locked_out", { ip, scope: "2fa" });
    return NextResponse.json(
      { error: "Too many attempts. Please wait 15 minutes and try again." },
      { status: 429, headers: { "Retry-After": String(15 * 60), "Cache-Control": "no-store" } }
    );
  }

  const pending = readCookie(req, ADMIN_PENDING_2FA_COOKIE);
  if (!verifyPending2faToken(pending)) {
    logSecurityEvent("admin_session_rejected", { ip, scope: "2fa-pending" });
    return NextResponse.json(
      { error: "Your login attempt expired. Please enter your password again." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  let body: { code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const secret = process.env.ADMIN_TOTP_SECRET || "";
  const code = typeof body.code === "string" ? body.code : "";
  if (!secret || !verifyTotp(secret, code)) {
    logSecurityEvent("admin_login_failed", { ip, reason: "totp" });
    return NextResponse.json({ error: "Incorrect code. Please try again." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  let token: string;
  try {
    token = createAdminSessionToken();
  } catch (err) {
    console.error("Admin 2FA login error:", err);
    return NextResponse.json(
      { error: "Server isn't configured for admin sessions — set ADMIN_SESSION_SECRET to a random string of 32+ characters." },
      { status: 500 }
    );
  }

  logSecurityEvent("admin_login_succeeded", { ip, scope: "2fa" });
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  });
  // The pending ticket has done its job — clear it either way.
  res.cookies.set(ADMIN_PENDING_2FA_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return res;
}
