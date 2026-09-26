import crypto from "crypto";
import bcrypt from "bcryptjs";
import { rateLimit, getClientIp } from "./rateLimit";
import { readCookie } from "./cookies";
import { logSecurityEvent } from "./securityLog";

export interface AdminAuthError {
  status: number;
  error: string;
}

// --- Server-side admin session (httpOnly cookie) -----------------------
//
// After a correct password, the server sets a signed, httpOnly cookie the
// browser sends automatically on every request. Page JavaScript can't read
// or write it, it survives refreshes, and it expires on its own. The
// password itself is never kept in the browser.

export const ADMIN_SESSION_COOKIE = "d2h_admin_session";
// Short-lived cookie proving "password was correct" while a 6-digit TOTP
// code is entered — a separate, much weaker cookie than the real session: it
// grants nothing by itself, only the right to attempt the second factor.
export const ADMIN_PENDING_2FA_COOKIE = "d2h_admin_pending";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const PENDING_2FA_TTL_MS = 5 * 60 * 1000; // 5 minutes to enter the code
const MIN_SESSION_SECRET_LENGTH = 32;

// The signing key MUST be a dedicated ADMIN_SESSION_SECRET (32+ random
// characters). It used to fall back to ADMIN_PASSWORD_HASH — which meant that
// anyone who ever saw the bcrypt hash (a leaked .env, a backup, a screenshot)
// could forge a valid admin session offline, without ever cracking the
// password. No secret → no sessions (fail closed), never a weaker key.
function getSessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET || "";
  return secret.length >= MIN_SESSION_SECRET_LENGTH ? secret : "";
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("hex");
}

// A short fingerprint of the CURRENT admin password hash is baked into every
// session. Change the admin password and every existing session — including a
// stolen cookie — stops working immediately, with no server-side session
// table needed.
function passwordFingerprint(): string {
  return crypto.createHash("sha256").update(process.env.ADMIN_PASSWORD_HASH || "").digest("hex").slice(0, 16);
}

/** Mints a new signed session token: `<expiresAtMs>.<passwordFingerprint>.<hmac>`. */
export function createAdminSessionToken(): string {
  if (!getSessionSecret()) {
    throw new Error(`ADMIN_SESSION_SECRET must be set to a random string of at least ${MIN_SESSION_SECRET_LENGTH} characters.`);
  }
  const payload = `${Date.now() + SESSION_TTL_MS}.${passwordFingerprint()}`;
  return `${payload}.${sign(payload)}`;
}

export const ADMIN_SESSION_MAX_AGE_SECONDS = Math.floor(SESSION_TTL_MS / 1000);

/** Verifies a session token's signature, expiry and password fingerprint. */
export function verifyAdminSessionToken(token: string | undefined | null): boolean {
  if (!token || !getSessionSecret()) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expires, fingerprint, signature] = parts;
  const payload = `${expires}.${fingerprint}`;
  if (!timingSafeEqual(sign(payload), signature)) return false;
  if (!timingSafeEqual(fingerprint, passwordFingerprint())) return false;
  const expiresAt = Number(expires);
  return Number.isFinite(expiresAt) && Date.now() <= expiresAt;
}

// --- Two-factor (TOTP) -----------------------------------------------
//
// Optional but strongly recommended: set ADMIN_TOTP_SECRET (see
// `node scripts/setup-admin-2fa.mjs`) and a correct password alone is no
// longer enough to get in — every login also needs the current 6-digit code
// from an authenticator app on your phone, which a leaked or guessed
// password does not give an attacker.
export function isTwoFactorEnabled(): boolean {
  return Boolean(process.env.ADMIN_TOTP_SECRET);
}

/** Mints the short-lived "password was correct, now enter your code" token. */
export function createPending2faToken(): string {
  const payload = `${Date.now() + PENDING_2FA_TTL_MS}.${passwordFingerprint()}`;
  return `${payload}.${sign(payload)}`;
}

export const PENDING_2FA_MAX_AGE_SECONDS = Math.floor(PENDING_2FA_TTL_MS / 1000);

/** Verifies the pending-2FA token: signature, expiry, and still the current password. */
export function verifyPending2faToken(token: string | undefined | null): boolean {
  if (!token || !getSessionSecret()) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expires, fingerprint, signature] = parts;
  const payload = `${expires}.${fingerprint}`;
  if (!timingSafeEqual(sign(payload), signature)) return false;
  if (!timingSafeEqual(fingerprint, passwordFingerprint())) return false;
  const expiresAt = Number(expires);
  return Number.isFinite(expiresAt) && Date.now() <= expiresAt;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Checks a submitted admin password against the bcrypt hash in
 * ADMIN_PASSWORD_HASH — the real password is never stored anywhere (not in
 * env, not in the database), only its hash, so it can't be read back out
 * even if the environment or a backup leaks. Generate the hash once with:
 *   node -e "console.log(require('bcryptjs').hashSync('your-password', 12))"
 */
export async function verifyAdminPassword(provided: string): Promise<boolean> {
  const hash = process.env.ADMIN_PASSWORD_HASH || "";
  if (!hash || !provided) return false;
  try {
    return await bcrypt.compare(provided, hash);
  } catch {
    return false;
  }
}

/**
 * Gate for every admin API route. The ONLY accepted credential is the signed,
 * httpOnly session cookie set by /api/admin/login. (Earlier versions also
 * accepted the raw password in an `x-admin-secret` header on every admin
 * endpoint — that let an attacker guess passwords at the generic per-IP rate
 * instead of the login form's strict 5-per-15-minutes lockout, so it is gone:
 * the password is now only ever checked by /api/admin/login.) Always returns
 * the same generic error whatever the reason, so nothing about a failure
 * leaks. Returns null when authorized.
 */
export async function requireAdmin(req: Request): Promise<AdminAuthError | null> {
  const ip = getClientIp(req);
  const { success } = await rateLimit(`admin-auth:${ip}`, 60, 60_000); // 60/min per IP
  if (!success) {
    logSecurityEvent("rate_limited", { scope: "admin-api", ip });
    return { status: 429, error: "Too many attempts. Please wait a minute and try again." };
  }

  const sessionToken = readCookie(req, ADMIN_SESSION_COOKIE);
  if (verifyAdminSessionToken(sessionToken)) return null;

  // Only worth logging when someone actually presented a cookie that failed
  // (expired / forged / password changed) — not every anonymous probe.
  if (sessionToken) logSecurityEvent("admin_session_rejected", { ip });
  return { status: 401, error: "Unauthorized" };
}
