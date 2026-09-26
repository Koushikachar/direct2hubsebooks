import type { Metadata } from "next";
import PolicyPage, { PolicySection } from "@/components/PolicyPage";

export const revalidate = 3600;
export const metadata: Metadata = {
  title: "Cookies Policy",
  description: "Which cookies Direct2hub uses, what each one is for, and why no consent banner blocks the site.",
};

export default function CookiesPage() {
  return (
    <PolicyPage
      title="Cookies Policy"
      intro="This page lists every cookie this site sets, in plain language. We do not use advertising or cross-site tracking cookies, and we never use browser local storage for anything."
    >
      <PolicySection title="Why there's no cookie pop-up">
        <p>
          Every cookie below is either strictly necessary to make the site work (keeping you logged in, remembering a
          payment you started, letting you edit your own review) or a simple first-party preference (your theme choice).
          None of them track you across other websites and none are used for advertising, so none require the
          &quot;accept/reject&quot; consent banner that ad or analytics-tracking cookies would.
        </p>
      </PolicySection>
      <PolicySection title="Cookies we set">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-black/10 dark:border-white/10">
                <th className="py-2 pr-4 font-semibold">Cookie</th>
                <th className="py-2 pr-4 font-semibold">Purpose</th>
                <th className="py-2 font-semibold">Expiry</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 dark:divide-white/10">
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">d2h-theme</td>
                <td className="py-2 pr-4">Remembers your light/dark mode choice.</td>
                <td className="py-2">1 year</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">d2h_vid</td>
                <td className="py-2 pr-4">Anonymous visitor ID used only for a simple visit count. No personal data.</td>
                <td className="py-2">Up to 400 days</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">d2h_pay</td>
                <td className="py-2 pr-4">Confirms this browser started a specific payment, so we can send you straight to your download after paying.</td>
                <td className="py-2">Session / short-lived</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">Review edit cookie</td>
                <td className="py-2 pr-4">Lets you edit or delete a review you posted from this browser. Set only after you submit a review.</td>
                <td className="py-2">Set per review</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">WhatsApp-joined flag</td>
                <td className="py-2 pr-4">Remembers that you confirmed joining our WhatsApp community, so we don&apos;t show the invite again.</td>
                <td className="py-2">Long-lived</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">Admin session cookies</td>
                <td className="py-2 pr-4">Keep our own staff logged in to the admin dashboard. Never set for regular visitors.</td>
                <td className="py-2">Session</td>
              </tr>
            </tbody>
          </table>
        </div>
      </PolicySection>
      <PolicySection title="Third-party scripts">
        <p>
          The only third-party script this site can load is Cloudflare Turnstile, and only on the staff admin login page
          — never on any page a customer visits. It may set its own cookie on that page to tell humans from bots; see{" "}
          <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer" className="font-semibold text-ember-600 underline underline-offset-4">
            Cloudflare&apos;s privacy policy
          </a>
          . We do not embed any social media widgets, ad networks, or analytics scripts from other companies on the
          storefront.
        </p>
      </PolicySection>
      <PolicySection title="Your choices">
        <p>
          You can block or delete cookies at any time in your browser settings. Blocking the strictly-necessary cookies
          above will break parts of the site (you may be signed out of an in-progress payment, or the theme toggle may
          stop remembering your choice), but the site will not stop working entirely.
        </p>
      </PolicySection>
      <PolicySection title="More detail">
        <p>
          For what personal information we collect more broadly (order details, messages, reviews) and why, see our{" "}
          <a href="/privacy" className="font-semibold text-ember-600 underline underline-offset-4">
            Privacy Policy
          </a>
          .
        </p>
      </PolicySection>
    </PolicyPage>
  );
}
