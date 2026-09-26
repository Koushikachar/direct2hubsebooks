// Cloudflare Turnstile — a free, privacy-respecting CAPTCHA. Verifies that
// the admin login form was submitted by a real browser, not a script; a
// scripted brute-force attempt can never even reach the password check.
// Optional: if TURNSTILE_SECRET_KEY isn't set, this step is skipped (so the
// site still works before you set it up) — see the README for how to add it.
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function isTurnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

export async function verifyTurnstileToken(token: string | undefined, remoteIp: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // not configured — don't block login on a missing optional feature
  if (!token) return false;
  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, remoteip: remoteIp }),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    console.error("Turnstile verification failed:", err);
    return false;
  }
}
