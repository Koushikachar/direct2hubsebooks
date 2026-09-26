import { NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rateLimit";
import { confirmPayuPayment } from "@/lib/payuFinalize";
import { PayuConfigError } from "@/lib/payu";
import { readCookie } from "@/lib/cookies";
import { PAYMENT_PROOF_COOKIE, hasPaymentProof } from "@/lib/paymentProof";
import { logSecurityEvent } from "@/lib/securityLog";

// A manual "check my payment again" fallback — used by the return page when
// PayU's surl/furl callback hasn't shown up yet (bank delay, dropped
// redirect, etc). Whether it was paid is decided by asking PayU directly
// (see lib/payuFinalize.ts), never by anything the client sends.
export async function POST(req: Request) {
  const ip = getClientIp(req);
  const { success } = await rateLimit(`verify-payment:${ip}`, 30, 10 * 60_000); // 30 checks / 10 min / IP
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please try again in a few minutes." }, { status: 429 });
  }

  const noStore = { "Cache-Control": "no-store" };

  try {
    const { orderId } = (await req.json()) as { orderId?: unknown };
    if (typeof orderId !== "string" || !orderId || orderId.length > 40) {
      return NextResponse.json({ error: "Missing payment details." }, { status: 400, headers: noStore });
    }

    const outcome = await confirmPayuPayment(orderId);
    switch (outcome.status) {
      case "paid": {
        // The access token is the buyer's download credential. Only hand it
        // to the browser that started THIS payment (signed cookie set at
        // create-order) AND only for the txnid that actually settled the
        // purchase — a txnid alone (it is printed on the invoice) is not
        // enough. Anyone else is told to use the emailed link.
        const proven = outcome.paidOrderId === orderId && hasPaymentProof(readCookie(req, PAYMENT_PROOF_COOKIE), orderId);
        if (!proven) {
          logSecurityEvent("payment_proof_missing", { orderId, ip });
          return NextResponse.json({ ok: true, status: "paid", emailed: true }, { headers: noStore });
        }
        return NextResponse.json({ ok: true, status: "paid", token: outcome.token }, { headers: noStore });
      }
      case "unpaid":
        return NextResponse.json({ ok: true, status: "unpaid" }, { headers: noStore });
      case "expired":
        return NextResponse.json({ ok: true, status: "expired" }, { headers: noStore });
      default:
        return NextResponse.json({ error: "No matching order found." }, { status: 404, headers: noStore });
    }
  } catch (err) {
    console.error("Verify payment error:", err);
    const error =
      err instanceof PayuConfigError
        ? "Payments aren't configured yet."
        : "Could not verify your payment. If money was deducted, please contact support.";
    return NextResponse.json({ error }, { status: 500, headers: noStore });
  }
}
