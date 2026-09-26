import { after } from "next/server";
import { prisma } from "@/lib/db";
import { CURRENCY, PRODUCT_PRICE_PAISE } from "@/lib/pricing";
import { verifyPayuPayment } from "@/lib/payu";
import { sendMail, orderConfirmationEmail } from "@/lib/mailer";
import { getSiteUrl } from "@/lib/siteUrl";
import { logSecurityEvent } from "@/lib/securityLog";
import { generateInvoicePdf, invoiceNumberFor } from "@/lib/invoice";
import type { Submission } from "@prisma/client";

export type PaymentOutcome =
  | {
      status: "paid";
      token: string;
      newlyPaid: boolean;
      /** The txnid that actually settled the purchase. Callers must only
       *  reveal `token` to someone presenting THIS txnid (see paymentProof). */
      paidOrderId: string | null;
    }
  /** PayU has no successful payment for this txnid (yet). */
  | { status: "unpaid" }
  /** Terminal failure — a fresh attempt is needed. */
  | { status: "expired" }
  /** Not a txnid we recognise, or its amount doesn't match what we charge. */
  | { status: "invalid" };

// The one place a purchase is ever marked as paid. Three independent paths
// funnel into it — PayU's surl/furl POST (/api/payment/callback), the
// return page itself (/payment/return, in case the callback never reaches
// us), and a manual re-check (/api/payment/verify) — so a buyer who pays and
// then closes the tab, loses signal, or is bounced through an in-app browser
// still gets their access.
//
// Nothing the browser (or the surl/furl POST body) says is trusted: the
// transaction is always re-read from PayU with our secret salt
// (verify_payment), and status + amount are checked before anything is
// unlocked. The submission is found via udf1 (the submission id we sent
// PayU, echoed back unchanged) rather than via whatever txnid happens to be
// stored on the row — so a late/duplicate callback for an older attempt
// still resolves to the right buyer even if a newer attempt has since
// overwritten submission.payuTxnId.
//
// It is idempotent and race-safe: the paid flag is set with a conditional
// UPDATE, and only the call that actually flips it sends the confirmation
// email — so the callback + return page + a manual re-check arriving
// together never double-email.
export async function confirmPayuPayment(txnid: string): Promise<PaymentOutcome> {
  if (!txnid || txnid.length > 40) return { status: "invalid" };

  const detail = await verifyPayuPayment(txnid);
  if (!detail) return { status: "invalid" };

  const submissionId = detail.udf1?.trim();
  if (!submissionId) return { status: "invalid" };

  const submission = await prisma.submission.findUnique({ where: { id: submissionId } });
  if (!submission) return { status: "invalid" };

  if (submission.paymentStatus === "paid") {
    return { status: "paid", token: submission.accessToken, newlyPaid: false, paidOrderId: submission.payuTxnId };
  }

  if (detail.status !== "success") {
    const isTerminal = detail.status === "failure" || detail.status === "dropped" || detail.status === "bounced";
    if (isTerminal) {
      // Record the failure so it shows up under the admin's "Failed" filter
      // instead of sitting in "Pending" forever. Conditional update so a
      // payment that settles as PAID through a different, concurrent path
      // is never clobbered back to "failed".
      await prisma.submission.updateMany({
        where: { id: submission.id, paymentStatus: { notIn: ["paid", "failed"] } },
        data: { paymentStatus: "failed" },
      });
      return { status: "expired" };
    }
    return { status: "unpaid" };
  }

  // Paid — but for the right thing? (Guards against a mis-priced or
  // tampered order ever unlocking the product.) PayU's domestic Hosted
  // Checkout is always INR for this account, so only the amount is checked.
  const paidPaise = Math.round(Number(detail.amt) * 100);
  if (!Number.isFinite(paidPaise) || paidPaise !== PRODUCT_PRICE_PAISE) {
    console.error(`PayU txn ${txnid} is success but amount mismatch:`, detail.amt, CURRENCY);
    logSecurityEvent("payment_amount_mismatch", { orderId: txnid });
    return { status: "invalid" };
  }

  const paymentId = detail.mihpayid;

  const { count } = await prisma.submission.updateMany({
    where: { id: submission.id, paymentStatus: { not: "paid" } },
    data: {
      paymentStatus: "paid",
      payuTxnId: txnid,
      payuPaymentId: paymentId,
      amountPaise: PRODUCT_PRICE_PAISE,
      paidAt: new Date(),
    },
  });

  if (count === 1) {
    const paid = await prisma.submission.findUnique({ where: { id: submission.id } });
    if (paid) runAfterResponse(() => sendOrderConfirmation(paid));
  }

  return { status: "paid", token: submission.accessToken, newlyPaid: count === 1, paidOrderId: txnid };
}

// Sends the email after the HTTP response has gone out (Next's after() keeps
// serverless functions alive until it finishes), so the buyer never waits on
// PDF generation + SMTP. Outside a request scope (scripts/tests) it simply
// runs immediately.
function runAfterResponse(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}

// Best-effort confirmation email — never blocks the response, and a failure
// here doesn't affect the (already-verified) payment. The invoice PDF is
// generated first, then both attached to the email and linked, so the buyer
// can always pull it up again later.
async function sendOrderConfirmation(paid: Submission): Promise<void> {
  try {
    const siteUrl = getSiteUrl();
    const amountLabel = `₹${(paid.amountPaise / 100).toFixed(0)}`;
    const invoiceNumber = invoiceNumberFor(paid);
    const product = await prisma.product.findFirst({ orderBy: { updatedAt: "desc" } });

    const invoicePdf = await generateInvoicePdf({
      submission: paid,
      productTitle: product?.title || "Direct2hub order",
      supportEmail: process.env.SUPPORT_EMAIL || process.env.RESEND_FROM_EMAIL,
      logoUrl: product?.logoUrl,
    });

    await sendMail({
      to: paid.email,
      subject: "Your Ecommerce Playbook is ready to download 🎉",
      html: orderConfirmationEmail({
        name: paid.name,
        accessUrl: `${siteUrl}/access/${paid.accessToken}`,
        invoiceUrl: `${siteUrl}/api/invoice/${paid.accessToken}`,
        amountLabel,
        invoiceNumber,
        logoUrl: product?.logoUrl,
      }),
      attachments: [{ filename: `invoice-${invoiceNumber}.pdf`, content: invoicePdf, contentType: "application/pdf" }],
    });
  } catch (err) {
    console.error("Order confirmation email failed:", err);
  }
}
