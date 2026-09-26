import { NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rateLimit";
import {
  verifyAdminPassword,
  createAdminSessionToken,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  isTwoFactorEnabled,
  createPending2faToken,
  ADMIN_PENDING_2FA_COOKIE,
  PENDING_2FA_MAX_AGE_SECONDS,
} from "@/lib/adminAuth";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { logSecurityEvent } from "@/lib/securityLog";
import { sendMail, securityAlertEmail } from "@/lib/mailer";

// Where to send a heads-up when the login lockout triggers — an early signal
// of a brute-force attempt against your admin panel. Optional: nothing is
// sent if none of these is set.
function alertRecipient(): string | undefined {
  return process.env.ALERT_EMAIL || process.env.RESEND_FROM_EMAIL || undefined;
}

// One alert per lockout streak, not one per blocked request — a real attack
// makes many requests per minute and nobody wants an inbox full of copies.
async function maybeSendLockoutAlert(ip: string): Promise<void> {
  const to = alertRecipient();
  if (!to) return;
  const { success } = await rateLimit("admin-lockout-alert", 1, 60 * 60_000); // at most 1/hour, site-wide
  if (!success) return;
  await sendMail({
    to,
    subject: "⚠️ Repeated admin login failures on Direct2hub",
    html: securityAlertEmail({
      heading: "Someone is repeatedly failing to log in to /admin",
      body: `The admin login has been locked out (5 wrong attempts in 15 minutes) from IP address ${ip}. If this wasn't you, no action is needed — the password is safe and the account stays locked for the cooldown period. If it keeps happening, consider enabling two-factor login (see the README) if you haven't already.`,
    }),
  });
}

export async function POST(req: Request) {
  const ip = getClientIp(req);

  // Strict brute-force guard for the password form itself: 5 attempts per
  // 15 minutes per IP, then a temporary lockout — the 6th attempt is refused
  // with a 429 before the password is even checked. (Every attempt counts,
  // right or wrong, so a bot can't probe for free.) bcrypt's cost factor
  // makes each guess expensive on top of this.
  const login = await rateLimit(`admin-login:${ip}`, 5, 15 * 60_000);
  if (!login.success) {
    logSecurityEvent("admin_login_locked_out", { ip });
    await maybeSendLockoutAlert(ip);
    return NextResponse.json(
      { error: "Too many login attempts. Please wait 15 minutes and try again." },
      { status: 429, headers: { "Retry-After": String(15 * 60), "Cache-Control": "no-store" } }
    );
  }

  // A hard daily ceiling on top of the 15-minute lockout: even spread across
  // many 15-minute windows (i.e. waiting out each lockout and trying again),
  // an attacker gets at most 15 guesses against this IP per day.
  const daily = await rateLimit(`admin-login-day:${ip}`, 15, 24 * 60 * 60_000);
  if (!daily.success) {
    logSecurityEvent("admin_login_locked_out", { ip, scope: "daily" });
    return NextResponse.json(
      { error: "Too many login attempts today. Please try again tomorrow, or contact support." },
      { status: 429, headers: { "Retry-After": String(24 * 60 * 60), "Cache-Control": "no-store" } }
    );
  }

  // Plus the general admin bucket (shared with requireAdmin) as a coarse
  // ceiling across every admin endpoint.
  const { success } = await rateLimit(`admin-auth:${ip}`, 20, 60_000);
  if (!success) {
    return NextResponse.json({ error: "Too many attempts. Please wait a minute and try again." }, { status: 429 });
  }

  let body: { password?: string; turnstileToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // CAPTCHA before the password check: a scripted brute-force attempt never
  // even reaches verifyAdminPassword (and never spends a bcrypt comparison).
  const captchaOk = await verifyTurnstileToken(body.turnstileToken, ip);
  if (!captchaOk) {
    logSecurityEvent("admin_login_failed", { ip, reason: "captcha" });
    return NextResponse.json({ error: "Please complete the verification and try again." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const password = typeof body.password === "string" ? body.password.slice(0, 200) : "";
  const ok = await verifyAdminPassword(password);
  if (!ok) {
    logSecurityEvent("admin_login_failed", { ip });
    return NextResponse.json({ error: "Incorrect admin password." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  // Password correct. If two-factor is set up, don't issue the real session
  // yet — only a short-lived "enter your code" ticket. The password alone
  // never grants access when 2FA is enabled.
  if (isTwoFactorEnabled()) {
    const res = NextResponse.json({ ok: true, totpRequired: true }, { headers: { "Cache-Control": "no-store" } });
    res.cookies.set(ADMIN_PENDING_2FA_COOKIE, createPending2faToken(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: PENDING_2FA_MAX_AGE_SECONDS,
    });
    return res;
  }

  let token: string;
  try {
    token = createAdminSessionToken();
  } catch (err) {
    console.error("Admin login error:", err);
    return NextResponse.json(
      { error: "Server isn't configured for admin sessions — set ADMIN_SESSION_SECRET to a random string of 32+ characters." },
      { status: 500 }
    );
  }

  logSecurityEvent("admin_login_succeeded", { ip });
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  // httpOnly: never readable/writable from page JavaScript — nothing to
  // steal via XSS and nothing stored in localStorage. secure: only sent
  // over HTTPS in production. sameSite=strict: never attached to any
  // cross-site request at all (the admin panel is a same-site app that
  // talks to its own API, so nothing legitimate needs it cross-site) —
  // the strongest CSRF guard the cookie itself can provide.
  res.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
