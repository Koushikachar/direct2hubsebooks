"use client";
import { useRef, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";

// Code-split: the terms text is only needed if someone opens it.
const TermsModal = dynamic(() => import("./TermsModal"), { ssr: false });

const COUNTRY_CODES = [{ code: "+91", label: "IN +91" }];

const PRICE_LABEL = "₹199";

interface OrderFormState {
  name: string;
  email: string;
  countryCode: string;
  whatsapp: string;
}

/** "test" while testing (PayU's Hosted Checkout test page), "production" once you go live. */
type PayuMode = "test" | "production";

interface OrderData {
  submissionId: string;
  /** PayU's txnid for this attempt. */
  orderId: string;
  /** Where the hidden form below posts to — PayU's hosted checkout page. */
  checkoutUrl: string;
  /** Hidden form fields (incl. the server-computed hash) to post as-is. */
  fields: Record<string, string>;
  mode: PayuMode;
  amount: number;
  currency: string;
  name: string;
  email: string;
}

type Step = "details" | "payment";
type Status = "idle" | "loading" | "error";

export default function OrderForm() {
  const [form, setForm] = useState<OrderFormState>({
    name: "",
    email: "",
    countryCode: "+91",
    whatsapp: "",
  });
  // Bot protection (see lib/botProtection.ts) — a hidden field real users
  // never see or fill, and the moment this form first rendered. Captured
  // once via useState's lazy initializer, not on every render.
  const [website, setWebsite] = useState("");
  const [formRenderedAt] = useState(() => Date.now());
  const [step, setStep] = useState<Step>("details");
  const [order, setOrder] = useState<OrderData | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [termsOpen, setTermsOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const payuFormRef = useRef<HTMLFormElement>(null);

  function update<K extends keyof OrderFormState>(
    field: K,
    value: OrderFormState[K],
  ) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // Step 1: save contact details, then immediately create the PayU order
  // (txnid + signed hash) so the payment step is ready to go with a single
  // "Pay" click.
  async function handleDetailsSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setMessage("");
    try {
      const submitRes = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, website, formRenderedAt }),
      });
      const submitData = await submitRes.json();
      if (!submitRes.ok)
        throw new Error(submitData.error || "Something went wrong");

      const orderRes = await fetch("/api/payment/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: submitData.submissionId }),
      });
      const orderData = await orderRes.json();
      if (!orderRes.ok)
        throw new Error(orderData.error || "Could not start payment");

      setOrder({
        submissionId: submitData.submissionId,
        orderId: orderData.orderId,
        checkoutUrl: orderData.checkoutUrl,
        fields: orderData.fields,
        mode: orderData.mode,
        amount: orderData.amount,
        currency: orderData.currency,
        // Shown back to the buyer from what THEY typed — the server no longer
        // echoes stored personal details.
        name: form.name.trim(),
        email: form.email.trim(),
      });
      setStatus("idle");
      setStep("payment");
    } catch (err) {
      setStatus("error");
      setMessage(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    }
  }

  // Step 2: hand off to PayU's hosted checkout page — a plain, real form
  // POST (full page navigation), not a fetch. PayU takes it from here: the
  // buyer pays on PayU's own page, then PayU posts the result straight back
  // to /api/payment/callback, which finalizes the purchase and sends the
  // browser on to /payment/return (and from there to the download page, once
  // payment is confirmed). Nothing about "did they pay" is ever decided in
  // this component.
  function handlePay() {
    if (!payuFormRef.current) return;
    setStatus("loading");
    setMessage("Redirecting to PayU…");
    payuFormRef.current.submit();
  }

  const isTestMode = order?.mode === "test";

  if (step === "payment" && order) {
    return (
      <div className="card space-y-4 p-6">
        <div className="flex items-center gap-2 rounded-lg bg-ember-600/10 px-3 py-2 text-sm font-medium text-ember-600">
          <span>✓</span> Details saved for {order.name}
        </div>

        {isTestMode && (
          <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-center text-xs font-medium text-amber-700">
            Test mode — no real money will be charged. Use PayU&apos;s
            test cards/UPI from their sandbox documentation.
          </div>
        )}

        <div className="rounded-lg border border-brick-700/10 p-4 text-center">
          <p className="text-sm text-brick-700/80">Amount to pay</p>
          <p className="font-display text-3xl font-bold text-ember-600">
            {PRICE_LABEL}
          </p>
        </div>

        {/* Real, top-level form POST straight to PayU's hosted checkout —
            never a fetch. Card/UPI details are entered on PayU's own page,
            so this site never touches them. */}
        <form ref={payuFormRef} method="POST" action={order.checkoutUrl}>
          {Object.entries(order.fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <button
            type="button"
            onClick={handlePay}
            disabled={status === "loading"}
            className="w-full rounded-lg bg-ember-600 py-3 font-semibold text-white transition hover:bg-ember-500 disabled:opacity-60"
          >
            {status === "loading" ? "Redirecting to PayU…" : `Pay ${PRICE_LABEL}`}
          </button>
        </form>

        <button
          type="button"
          onClick={() => setStep("details")}
          className="w-full text-center text-xs text-brick-700/80 underline"
        >
          Edit your details
        </button>

        {message && (
          <p
            role={status === "error" ? "alert" : "status"}
            className={`text-center text-sm ${status === "error" ? "text-red-500" : "text-brick-700/80"}`}
          >
            {message}
          </p>
        )}

        <p className="text-center text-xs text-brick-700/80">
          Payments are processed securely by PayU (UPI, cards, netbanking,
          wallets).
        </p>
      </div>
    );
  }

  return (
    <>
      <form onSubmit={handleDetailsSubmit} className="card space-y-4 p-6">
        {/* Honeypot — invisible to real visitors (hidden off-screen with
            CSS, not `type="hidden"`, which some bots specifically skip),
            but a simple bot's auto-filler will fill it. tabIndex -1 and
            autoComplete off keep it out of keyboard tabbing and browser
            autofill for genuine users. */}
        <div className="absolute -left-[9999px] top-auto h-0 w-0 overflow-hidden" aria-hidden="true">
          <label htmlFor="website">Website</label>
          <input
            id="website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-ember-600/10 px-3 py-2 text-sm font-medium text-ember-600">
          <span>✓</span> Unlocks Digital Product — {PRICE_LABEL}
        </div>

        <div>
          <label htmlFor="order-name" className="mb-1 block text-xs font-medium text-brick-700">
            Name
          </label>
          <input
            id="order-name"
            name="name"
            required
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="Your full name"
            className="w-full rounded-lg border border-brick-700/20 bg-transparent px-3 py-2.5 outline-none ring-ember-500/40 focus:ring-2"
          />
        </div>

        <div>
          <label htmlFor="order-email" className="mb-1 block text-xs font-medium text-brick-700">
            Email Address
          </label>
          <input
            id="order-email"
            name="email"
            required
            type="email"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-brick-700/20 bg-transparent px-3 py-2.5 outline-none ring-ember-500/40 focus:ring-2"
          />
        </div>

        <div>
          <label htmlFor="order-whatsapp" className="mb-1 block text-xs font-medium text-brick-700">
            WhatsApp Number
          </label>

          <div className="flex gap-2">
            <label htmlFor="order-country-code" className="sr-only">
              Country code
            </label>
            <select
              id="order-country-code"
              value={form.countryCode}
              onChange={(e) => update("countryCode", e.target.value)}
              className="rounded-lg border border-brick-700/20 bg-transparent px-2 py-2.5 outline-none"
            >
              {COUNTRY_CODES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>

            <input
              id="order-whatsapp"
              name="whatsapp"
              required
              type="tel"
              inputMode="numeric"
              maxLength={10}
              minLength={10}
              pattern="[6-9][0-9]{9}"
              value={form.whatsapp}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, "").slice(0, 10);

                update("whatsapp", value);
              }}
              placeholder="9876543210"
              className="w-full rounded-lg border border-brick-700/20 bg-transparent px-3 py-2.5 outline-none ring-ember-500/40 focus:ring-2"
            />
          </div>

          {form.whatsapp.length > 0 && form.whatsapp.length !== 10 && (
            <p className="mt-1 text-xs text-red-500">
              WhatsApp number must contain exactly 10 digits.
            </p>
          )}
        </div>

        <div className="flex items-start gap-2.5">
          <input
            id="order-consent"
            type="checkbox"
            required
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-brick-700/30 text-ember-600 focus:ring-2 focus:ring-ember-500/40"
          />
          <label htmlFor="order-consent" className="text-xs text-brick-700/80">
            I agree to Direct2hub&apos;s{" "}
            <button type="button" onClick={() => setTermsOpen(true)} className="font-semibold text-ember-600 underline underline-offset-4">
              Terms
            </button>
            ,{" "}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="font-semibold text-ember-600 underline underline-offset-4">
              Privacy Policy
            </a>
            , and{" "}
            <a href="/refund-policy" target="_blank" rel="noopener noreferrer" className="font-semibold text-ember-600 underline underline-offset-4">
              Refund Policy
            </a>
            , and consent to my name, email and WhatsApp number above being used to deliver and support this order.
          </label>
        </div>

        <button
          type="submit"
          disabled={status === "loading" || !consent}
          className="w-full rounded-lg bg-ember-600 py-3 font-semibold text-white transition hover:bg-ember-500 disabled:opacity-60"
        >
          {status === "loading"
            ? "Continuing…"
            : `Continue to payment — ${PRICE_LABEL}`}
        </button>

        {status === "error" && (
          <p className="text-center text-sm text-red-500">{message}</p>
        )}
      </form>

      {termsOpen && <TermsModal open={termsOpen} onClose={() => setTermsOpen(false)} />}
    </>
  );
}
