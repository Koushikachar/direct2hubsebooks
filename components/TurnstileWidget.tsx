"use client";
import { useEffect, useId, useRef } from "react";

// Cloudflare Turnstile's script is the ONLY third-party script this loads —
// and only on the admin login form, never on a public page. It renders an
// invisible-or-checkbox challenge and calls onToken() with a one-time
// verification token, which the login route checks server-side
// (lib/turnstile.ts) before it will even look at the password.
declare global {
  interface Window {
    turnstile?: {
      render: (el: string | HTMLElement, opts: { sitekey: string; callback: (token: string) => void; "error-callback"?: () => void; theme?: "light" | "dark" | "auto" }) => string;
      reset: (id?: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
let scriptPromise: Promise<void> | null = null;
function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      resolve();
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export default function TurnstileWidget({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const elRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    let cancelled = false;
    loadTurnstileScript().then(() => {
      if (cancelled || !window.turnstile || !elRef.current) return;
      window.turnstile.render(elRef.current, {
        sitekey: siteKey,
        callback: onToken,
        theme: "auto",
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  return <div ref={elRef} id={`turnstile-${id}`} className="my-2 flex justify-center" />;
}
