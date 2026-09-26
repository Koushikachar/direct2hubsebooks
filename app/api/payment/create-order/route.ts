import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildTxnId, buildCheckoutFields, PayuApiError, PayuConfigError } from "@/lib/payu";
import { PRODUCT_PRICE_PAISE, CURRENCY } from "@/lib/pricing";
import { rateLimit, getClientIp } from "@/lib/rateLimit";
import { getSiteUrl } from "@/lib/siteUrl";
import { readCookie } from "@/lib/cookies";
import { PAYMENT_PROOF_COOKIE, addPaymentProof, paymentProofCookieOptions } from "@/lib/paymentProof";

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const { success } = await rateLimit(`create-order:${ip}`, 10, 10 * 60_000); // 10 attempts / 10 min / IP
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please try again in a few minutes." }, { status: 429 });
  }

  try {
    const { submissionId } = (await req.json()) as { submissionId?: string };
    if (!submissionId || typeof submissionId !== "string") {
      return NextResponse.json({ error: "Missing submission." }, { status: 400 });
    }

    const submission = await prisma.submission.findUnique({ where: { id: submissionId } });
    if (!submission) {
      return NextResponse.json({ error: "Submission not found. Please fill the form again." }, { status: 404 });
    }
    if (submission.paymentStatus === "paid") {
      return NextResponse.json({ error: "This has already been paid for." }, { status: 409 });
    }

    // Amount always comes from the server's own price constant — the
    // client only ever tells us WHO is paying, never HOW MUCH.
    const txnid = buildTxnId();
    const siteUrl = getSiteUrl();

    // PayU POSTs the result of the payment straight back to these URLs —
    // this IS the confirmation path (see app/api/payment/callback), so they
    // must be reachable from the internet. On http://localhost PayU cannot
    // reach them at all; use a tunnel (ngrok etc.) with NEXT_PUBLIC_SITE_URL
    // set to it for local end-to-end testing.
    const { fields, checkoutUrl, mode } = buildCheckoutFields({
      txnid,
      amountInr: PRODUCT_PRICE_PAISE / 100,
      productinfo: "The Ecommerce Playbook",
      firstname: submission.name,
      email: submission.email,
      // PayU wants the national number; +91 is the only country the form
      // offers, anything else is passed with its country code attached.
      phone:
        submission.countryCode === "+91"
          ? submission.whatsapp.replace(/\D/g, "")
          : `${submission.countryCode}${submission.whatsapp.replace(/\D/g, "")}`,
      submissionId: submission.id,
      surl: `${siteUrl}/api/payment/callback`,
      furl: `${siteUrl}/api/payment/callback`,
    });

    await prisma.submission.update({
      where: { id: submission.id },
      data: { payuTxnId: txnid, amountPaise: PRODUCT_PRICE_PAISE },
    });

    // Deliberately no name/email/phone beyond what's already in `fields`:
    // the caller only needs to POST straight through to PayU's hosted page.
    const res = NextResponse.json(
      {
        ok: true,
        orderId: txnid,
        checkoutUrl,
        fields,
        mode,
        amount: PRODUCT_PRICE_PAISE,
        currency: CURRENCY,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
    // Signed proof that THIS browser started this order — see lib/paymentProof.ts.
    res.cookies.set(
      PAYMENT_PROOF_COOKIE,
      addPaymentProof(readCookie(req, PAYMENT_PROOF_COOKIE), txnid),
      paymentProofCookieOptions()
    );
    return res;
  } catch (err) {
    // Full detail for the owner, in the server log (Vercel → Logs). Never
    // includes secrets or the request body.
    console.error(
      "Create order error:",
      err instanceof PayuApiError
        ? { status: err.status, message: err.message }
        : err instanceof Error
          ? err.message
          : String(err)
    );

    let hint = "Could not start payment. Please try again.";
    if (err instanceof PayuConfigError) {
      hint = "Payments aren't configured yet — set PAYU_MERCHANT_KEY and PAYU_MERCHANT_SALT.";
    } else if (err instanceof PayuApiError) {
      hint = `The payment gateway couldn't accept this order. (${err.message.slice(0, 200)})`;
    }

    return NextResponse.json({ error: hint }, { status: 500 });
  }
}
