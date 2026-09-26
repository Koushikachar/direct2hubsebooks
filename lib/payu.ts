import crypto from "crypto";

// Server-only PayU (India) client. PayU's classic "Hosted Checkout" flow is
// a plain HTML form POST — the browser is redirected to PayU's own payment
// page (no third-party JS SDK, no iframe), so this app never touches card
// data and stays out of PCI scope. We only ever call PayU's REST endpoints
// ourselves for one thing: verify_payment, to ask "did this really get
// paid?" using our secret salt. Nothing the browser reports is ever trusted
// on its own — see lib/payuFinalize.ts.
//
// PAYU_MERCHANT_SALT must never reach the browser. Going from test to live
// needs no code change: swap PAYU_MERCHANT_KEY / PAYU_MERCHANT_SALT for your
// production values and set PAYU_ENV=production.

const REQUEST_TIMEOUT_MS = 15_000;

export type PayuMode = "test" | "production";

export class PayuConfigError extends Error {}

export class PayuApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface PayuConfig {
  key: string;
  salt: string;
  mode: PayuMode;
  /** Hosted checkout page — the <form action> the browser is sent to. */
  checkoutUrl: string;
  /** Server-to-server verify_payment endpoint. */
  verifyUrl: string;
}

export function getPayuConfig(): PayuConfig {
  const key = process.env.PAYU_MERCHANT_KEY?.trim();
  const salt = process.env.PAYU_MERCHANT_SALT?.trim();
  if (!key || !salt) {
    throw new PayuConfigError("PAYU_MERCHANT_KEY and PAYU_MERCHANT_SALT must be set to accept payments.");
  }
  // Test unless production is asked for explicitly — a missing or
  // misspelled value can never accidentally point test code at live money.
  const env = (process.env.PAYU_ENV || "").trim().toLowerCase();
  const mode: PayuMode = env === "production" || env === "prod" || env === "live" ? "production" : "test";
  return {
    key,
    salt,
    mode,
    checkoutUrl: mode === "production" ? "https://secure.payu.in/_payment" : "https://test.payu.in/_payment",
    verifyUrl:
      mode === "production"
        ? "https://info.payu.in/merchant/postservice?form=2"
        : "https://test.payu.in/merchant/postservice?form=2",
  };
}

// ── Transaction ids ────────────────────────────────────────────────────
// PayU's txnid is capped at 25 alphanumeric characters — far too short to
// embed our own (cuid) submission id the way the previous Cashfree
// integration did. Instead the submission id travels in udf1 (PayU echoes
// udf1..udf5 back unchanged in both the surl/furl POST and verify_payment),
// which is how lib/payuFinalize.ts always finds the right submission,
// independent of whichever txnid happens to be the latest one stored on it.
export function buildTxnId(): string {
  return `d2h${crypto.randomBytes(9).toString("hex")}`; // 21 chars, alphanumeric
}

// PayU validates names/product info fairly strictly — keep letters, marks,
// spaces and a few punctuation marks, and fall back to something non-empty.
function cleanText(value: string, fallback: string, max: number): string {
  const cleaned = value.replace(/[^\p{L}\p{M}\p{N} .'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, max);
  return cleaned || fallback;
}

export interface PayuCheckoutInput {
  txnid: string;
  /** PayU takes rupees (e.g. 199.00), not paise. */
  amountInr: number;
  productinfo: string;
  firstname: string;
  email: string;
  /** National number, digits only. */
  phone: string;
  /** The submission this order belongs to — carried in udf1, see above. */
  submissionId: string;
  surl: string;
  furl: string;
}

export interface PayuCheckoutFields {
  key: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  phone: string;
  surl: string;
  furl: string;
  udf1: string;
  udf2: "";
  udf3: "";
  udf4: "";
  udf5: "";
  hash: string;
}

// PayU's classic (Salt v1) request-hash sequence:
//   sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt)
// The five empty fields before salt stand in for udf6-udf10, which this
// integration never uses.
function requestHash(
  cfg: Pick<PayuConfig, "key" | "salt">,
  f: Omit<PayuCheckoutFields, "key" | "hash">
): string {
  const parts = [
    cfg.key,
    f.txnid,
    f.amount,
    f.productinfo,
    f.firstname,
    f.email,
    f.udf1,
    f.udf2,
    f.udf3,
    f.udf4,
    f.udf5,
    "",
    "",
    "",
    "",
    "",
    cfg.salt,
  ];
  return crypto.createHash("sha512").update(parts.join("|")).digest("hex");
}

export function buildCheckoutFields(input: PayuCheckoutInput): { fields: PayuCheckoutFields; checkoutUrl: string; mode: PayuMode } {
  const cfg = getPayuConfig();
  const base: Omit<PayuCheckoutFields, "key" | "hash"> = {
    txnid: input.txnid,
    amount: input.amountInr.toFixed(2),
    productinfo: cleanText(input.productinfo, "Digital product", 100),
    firstname: cleanText(input.firstname, "Customer", 60),
    email: input.email.trim().slice(0, 100),
    phone: input.phone.replace(/\D/g, "").slice(0, 15),
    surl: input.surl,
    furl: input.furl,
    udf1: input.submissionId,
    udf2: "",
    udf3: "",
    udf4: "",
    udf5: "",
  };
  const fields: PayuCheckoutFields = { key: cfg.key, ...base, hash: requestHash(cfg, base) };
  return { fields, checkoutUrl: cfg.checkoutUrl, mode: cfg.mode };
}

// ── Response verification (surl/furl POST from PayU) ─────────────────────
// Reverse hash sequence:
//   sha512(salt|status|udf10|udf9|udf8|udf7|udf6|udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
export interface PayuResponseFields {
  key: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  status: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
  hash: string;
}

export function verifyResponseSignature(f: PayuResponseFields): boolean {
  let cfg: Pick<PayuConfig, "key" | "salt">;
  try {
    cfg = getPayuConfig();
  } catch {
    return false;
  }
  if (f.key !== cfg.key) return false;
  const parts = [
    cfg.salt,
    f.status,
    "",
    "",
    "",
    "",
    "",
    f.udf5 || "",
    f.udf4 || "",
    f.udf3 || "",
    f.udf2 || "",
    f.udf1 || "",
    f.email,
    f.firstname,
    f.productinfo,
    f.amount,
    f.txnid,
    cfg.key,
  ];
  const expected = crypto.createHash("sha512").update(parts.join("|")).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from((f.hash || "").toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Verify payment (source of truth) ──────────────────────────────────
export interface PayuTransactionDetails {
  txnid: string;
  /** "Not Found" when PayU has no record of this txnid. */
  mihpayid: string;
  /** success | failure | pending | Not Found | ... */
  status: string;
  amt?: string;
  udf1?: string;
  mode?: string;
}

export async function verifyPayuPayment(txnid: string): Promise<PayuTransactionDetails | null> {
  const cfg = getPayuConfig();
  const hash = crypto.createHash("sha512").update(`${cfg.key}|verify_payment|${txnid}|${cfg.salt}`).digest("hex");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(cfg.verifyUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ key: cfg.key, command: "verify_payment", var1: txnid, hash }).toString(),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new PayuApiError(`PayU verify request failed (${res.status})`, res.status);
    const data = (await res.json()) as {
      status?: number;
      transaction_details?: Record<string, PayuTransactionDetails>;
    };
    const detail = data.transaction_details?.[txnid];
    if (!detail || detail.mihpayid === "Not Found" || detail.status === "Not Found") return null;
    return detail;
  } catch (err) {
    if (err instanceof PayuApiError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new PayuApiError("PayU did not respond in time.", 504);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
