"use client";
import { useEffect, useState } from "react";
import { getCookie, setCookie } from "@/lib/clientCookie";

const DISMISSED_COOKIE = "d2h_cookie_notice_seen";

/**
 * Every cookie this site sets is strictly necessary or a simple first-party
 * preference (see /cookies) — there's nothing to opt in or out of, so this
 * is a one-time transparency notice, not a consent gate. It never blocks
 * the page and never disables anything if dismissed. State lives in a
 * first-party cookie, same as the rest of the site (never localStorage).
 */
export default function CookieNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!getCookie(DISMISSED_COOKIE)) setVisible(true);
  }, []);

  function dismiss() {
    setCookie(DISMISSED_COOKIE, "1");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-[80] mx-auto flex max-w-3xl flex-col items-center gap-3 border border-brick-700/10 bg-white/95 px-4 py-3.5 text-center shadow-2xl backdrop-blur sm:bottom-4 sm:left-4 sm:right-auto sm:flex-row sm:rounded-2xl sm:text-left dark:border-white/10 dark:bg-[#1b100c]/95"
    >
      <p className="text-xs text-brick-700/80 dark:text-cream/70">
        We only use essential, first-party cookies (no advertising or tracking cookies) — see our{" "}
        <a href="/cookies" className="font-semibold text-ember-600 underline underline-offset-4">
          Cookies Policy
        </a>
        .
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded-full bg-ember-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-ember-500"
      >
        Got it
      </button>
    </div>
  );
}
