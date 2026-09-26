import { NextResponse } from "next/server";
import { verifyResponseSignature } from "@/lib/payu";
import { confirmPayuPayment } from "@/lib/payuFinalize";
import { logSecurityEvent } from "@/lib/securityLog";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { getSiteUrl } from "@/lib/siteUrl";

// PayU → this server. Both surl (success) and furl (failure) from
// create-order point here: after the buyer finishes on PayU's hosted page,
// PayU POSTs the result straight to this URL as a real (top-level) browser
// request, then we redirect the browser on to /payment/return. This is what
// completes a purchase when the buyer pays and then closes the tab, loses
// signal, or never comes back on their own — the order is confirmed and the
// access email goes out regardless of what their browser did afterwards.
//
// Nothing posted here is trusted on its own: confirmPayuPayment() always
// re-reads the transaction from PayU with our secret salt
// (verify_payment) before anything is unlocked. The signature check below
// is only a cheap first filter against obviously-forged POSTs; it is never
// the thing that decides whether someone gets paid access.
export async function POST(req: Request) {
  const ip = getClientIp(req);
  const { success } = await rateLimit(`payment-callback:${ip}`, 60, 10 * 60_000);
  if (!success) {
    return NextResponse.redirect(`${getSiteUrl()}/payment/return`, { status: 303 });
  }

  const raw = await req.text();
  const params = new URLSearchParams(raw);
  const txnid = params.get("txnid");

  if (txnid) {
    const fields = {
      key: params.get("key") || "",
      txnid,
      amount: params.get("amount") || "",
      productinfo: params.get("productinfo") || "",
      firstname: params.get("firstname") || "",
      email: params.get("email") || "",
      status: params.get("status") || "",
      udf1: params.get("udf1") || "",
      udf2: params.get("udf2") || "",
      udf3: params.get("udf3") || "",
      udf4: params.get("udf4") || "",
      udf5: params.get("udf5") || "",
      hash: params.get("hash") || "",
    };
    if (!verifyResponseSignature(fields)) {
      logSecurityEvent("webhook_bad_signature", { orderId: txnid, ip });
      // Still fall through to a real verify_payment call below — the
      // signature is a filter, not the source of truth.
    }
  }

  const dest = new URL("/payment/return", getSiteUrl());
  if (txnid) dest.searchParams.set("txnid", txnid);

  try {
    if (txnid) await confirmPayuPayment(txnid); // writes the DB row; the return page reads it back
  } catch (err) {
    console.error("PayU callback processing error:", err);
  }

  return NextResponse.redirect(dest.toString(), { status: 303 });
}

// Some integrations end up with PayU (or a manual dashboard "Test" click)
// hitting this URL with GET — bounce it to the return page instead of a
// bare 405 so nothing looks broken.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const txnid = url.searchParams.get("txnid");
  const dest = new URL("/payment/return", getSiteUrl());
  if (txnid) dest.searchParams.set("txnid", txnid);
  return NextResponse.redirect(dest.toString(), { status: 303 });
}
