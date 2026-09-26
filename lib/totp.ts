import crypto from "crypto";

// A minimal RFC 6238 TOTP (Time-based One-Time Password) implementation —
// the same standard Google Authenticator, Authy, 1Password etc. use. No
// dependency: it's ~40 lines of HMAC-SHA1 and base32, both already in Node.
// This is what makes the admin password alone not enough to get in: even a
// correctly guessed or leaked password still needs the 6-digit code from
// your phone, which changes every 30 seconds and is never sent anywhere but
// this server.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

export function generateBase32Secret(bytes = 20): string {
  const buf = crypto.randomBytes(bytes);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * Verifies a 6-digit code against the given base32 secret, allowing the
 * previous, current and next 30-second window (±30s of clock drift) — the
 * same tolerance most authenticator apps and servers use.
 */
export function verifyTotp(secret: string, code: string): boolean {
  const clean = code.replace(/\D/g, "");
  if (clean.length !== DIGITS) return false;
  const key = base32Decode(secret);
  if (key.length === 0) return false;
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  for (const drift of [0, -1, 1]) {
    const expected = hotp(key, counter + drift);
    const a = Buffer.from(expected);
    const b = Buffer.from(clean);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** The otpauth:// URI an authenticator app scans (as a QR code) or accepts by hand. */
export function totpAuthUri(secret: string, account = "admin", issuer = "Direct2hub"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
