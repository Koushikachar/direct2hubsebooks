#!/usr/bin/env node
// One-time helper: generates a new TOTP secret for admin two-factor login
// and prints everything you need to set it up. Run locally, never on a
// server: `node scripts/setup-admin-2fa.mjs`
import crypto from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(bytes) {
  let bits = 0, value = 0, out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

const secret = base32(crypto.randomBytes(20));
const uri = `otpauth://totp/Direct2hub:admin?secret=${secret}&issuer=Direct2hub&digits=6&period=30`;
const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(uri)}`;

console.log(`
Add this line to your .env (and to your host's environment variables):

  ADMIN_TOTP_SECRET="${secret}"

Then scan this QR code with Google Authenticator / Authy / 1Password (or open
the link in a browser and scan it from there):

  ${qrUrl}

Can't scan? Add the account manually in your authenticator app with:
  Account name: Direct2hub admin
  Key: ${secret}
  Type: Time-based (TOTP), 6 digits, 30 seconds

Once ADMIN_TOTP_SECRET is set, /admin will ask for a 6-digit code from your
app every time you log in, in addition to your password. Losing your phone
without a backup means losing admin access — see the README for a recovery
plan (a printed backup code, or temporarily unsetting ADMIN_TOTP_SECRET from
your host's environment settings).
`);
