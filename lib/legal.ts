// Single source for the policy pages, the footer links and the sitemap.
// PayU (like other Indian payment gateways) reviews a website's KYC/website
// details before activating live payments, and expects visible Contact Us,
// Terms and Conditions and Refunds and Cancellations pages (plus
// products/services with prices in INR).
export const LEGAL_LINKS = [
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/cookies", label: "Cookies Policy" },
  { href: "/refund-policy", label: "Refunds & Cancellations" },
  { href: "/contact", label: "Contact Us" },
] as const;

// Bump this when you change the wording of a policy.
export const POLICIES_LAST_UPDATED = "25 September 2026";
