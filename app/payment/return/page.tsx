import type { Metadata } from "next";
import Link from "next/link";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { confirmPayuPayment, type PaymentOutcome } from "@/lib/payuFinalize";
import { rateLimit, getClientIp } from "@/lib/rateLimit";
import { PAYMENT_PROOF_COOKIE, hasPaymentProof } from "@/lib/paymentProof";

export const metadata: Metadata = {
  title: "Confirming your payment | Direct2hub",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

// PayU's hosted checkout finishes with a POST to /api/payment/callback
// (surl/furl), which already finalizes the payment and redirects the buyer
// here. Nothing on this page is trusted on its own either: the txnid is
// re-checked with PayU server-side (confirmPayuPayment is idempotent — this
// is cheap once already paid), and a paid one goes straight on to the
// download page.
export default async function PaymentReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ txnid?: string | string[] }>;
}) {
  const raw = (await searchParams).txnid;
  const txnid = Array.isArray(raw) ? raw[0] : raw;

  let outcome: PaymentOutcome | { status: "error" } = { status: "invalid" };
  if (txnid && txnid.length <= 40) {
    try {
      const ip = getClientIp(new Request("http://internal", { headers: await headers() }));
      const { success } = await rateLimit(`payment-return:${ip}`, 30, 10 * 60_000);
      outcome = success ? await confirmPayuPayment(txnid) : { status: "error" };
    } catch (err) {
      console.error("Payment return error:", err);
      outcome = { status: "error" };
    }
  }

  // Only the browser that started this payment (signed cookie from
  // create-order) is sent on to the download page; a txnid alone — it is
  // printed on invoices — must never be enough to obtain the download link.
  let paidElsewhere = false;
  if (outcome.status === "paid" && txnid) {
    const proof = (await cookies()).get(PAYMENT_PROOF_COOKIE)?.value;
    if (outcome.paidOrderId === txnid && hasPaymentProof(proof, txnid)) {
      // redirect() throws by design — keep it outside any try/catch.
      redirect(`/access/${outcome.token}`);
    }
    paidElsewhere = true;
  }

  const copy = {
    paid: {
      title: "Payment received — check your email",
      body: "Your payment went through. We've emailed your download link and invoice to the address you used at checkout (check spam if it doesn't show up within a couple of minutes).",
    },
    unpaid: {
      title: "We haven't received your payment yet",
      body: "Some banks take a minute or two to confirm. This page refreshes itself — if the money was deducted, your download link will arrive by email shortly, so you don't need to pay again.",
    },
    expired: {
      title: "This payment wasn't successful",
      body: "No charge went through for it. Please start again from the checkout page.",
    },
    invalid: {
      title: "We couldn't find that payment",
      body: "The link looks incomplete. If money was deducted, please contact support with your email address.",
    },
    error: {
      title: "We couldn't check your payment just now",
      body: "This is usually temporary. Please refresh in a moment — if money was deducted, your download link will still be emailed to you.",
    },
  }[paidElsewhere ? "paid" : (outcome.status as "unpaid" | "expired" | "invalid" | "error")];

  return (
    <>
      <Nav />
      {/* A still-processing payment re-checks itself every few seconds. */}
      {(outcome.status === "unpaid" || outcome.status === "error") && txnid && (
        <meta httpEquiv="refresh" content={`5;url=/payment/return?txnid=${encodeURIComponent(txnid)}`} />
      )}
      <main className="mx-auto max-w-xl px-4 py-20 text-center">
        <div className="card space-y-4 p-8">
          <h1 className="font-display text-2xl font-bold">{copy.title}</h1>
          <p className="text-sm text-brick-700/80">{copy.body}</p>
          <Link
            href="/price"
            className="inline-block rounded-lg bg-ember-600 px-6 py-3 font-semibold text-white transition hover:bg-ember-500"
          >
            Back to checkout
          </Link>
        </div>
      </main>
    </>
  );
}
