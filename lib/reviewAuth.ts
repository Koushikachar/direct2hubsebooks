import crypto from "crypto";

// A reviewer gets a random token back exactly once, right after they submit
// a review. Only its SHA-256 hash is stored, so editing/deleting later
// requires possessing that original token — nobody else, including someone
// reading the database directly, can derive it back from the hash.
//
// The token itself never reaches page JavaScript: the server hands it to the
// browser as an httpOnly cookie scoped to /api/reviews (see
// reviewCookieName below), so an XSS bug can't read it the way it could
// from localStorage. The browser just attaches it automatically when the
// reviewer later edits or deletes their own review.

export function generateEditToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function hashEditToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function verifyEditToken(token: string, hash: string | null): boolean {
  if (!token || !hash) return false;
  const a = Buffer.from(hashEditToken(token));
  const b = Buffer.from(hash);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// One httpOnly cookie per review, e.g. `d2h_rt_<reviewId>` = <editToken>.
// Scoped to /api/reviews so it is never sent to any other route, and
// SameSite=Strict so it is never attached to a cross-site request.
export const REVIEW_COOKIE_PREFIX = "d2h_rt_";
export const REVIEW_COOKIE_PATH = "/api/reviews";
export const REVIEW_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function reviewCookieName(reviewId: string): string {
  return `${REVIEW_COOKIE_PREFIX}${reviewId}`;
}

export function reviewCookieOptions(maxAge = REVIEW_COOKIE_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: REVIEW_COOKIE_PATH,
    maxAge,
  };
}

// --- Verified-purchase reviews -------------------------------------------
//
// Only someone who can produce their own order's access code may post a
// review (see app/api/reviews/route.ts). That code is the same 14-char
// token used in their download link (lib/tokens.ts) — emailed to them at
// checkout, ~83 bits of entropy, not brute-forceable at any request rate a
// rate limiter would ever allow through. Accepting either the bare code or
// the full link means the reviewer can just paste whichever they still
// have open (their confirmation email or the /access/<token> page itself).
const ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9]{8,40}$/;

export function extractOrderAccessToken(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;

  // A pasted link, e.g. https://direct2hub.example/access/AbC123... — pull
  // just the token segment out of it.
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const parts = url.pathname.split("/").filter(Boolean);
      const idx = parts.indexOf("access");
      const candidate = idx >= 0 ? parts[idx + 1] : parts[parts.length - 1];
      return candidate && ACCESS_TOKEN_PATTERN.test(candidate) ? candidate : null;
    } catch {
      return null;
    }
  }

  return ACCESS_TOKEN_PATTERN.test(value) ? value : null;
}
