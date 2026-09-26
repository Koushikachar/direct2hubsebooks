import { getSiteUrl } from "@/lib/siteUrl";
import { PRODUCT_PRICE_INR, CURRENCY } from "@/lib/pricing";

interface StructuredDataProps {
  productTitle: string;
  productDescription: string;
  logoUrl: string;
  heroImageUrl: string;
  reviewCount: number;
  reviewAverage: number;
}

// JSON-LD structured data — read by both classic search engines (Google's
// rich results: star rating + price snippet) and, increasingly, by AI
// answer engines (ChatGPT/Perplexity/Google's AI Overviews) that pull
// structured facts rather than crawling and summarizing prose. Emitting it
// once, server-side, on the homepage covers the same Organization/Product
// facts every crawler needs regardless of which one shows up.
export default function StructuredData({
  productTitle,
  productDescription,
  logoUrl,
  heroImageUrl,
  reviewCount,
  reviewAverage,
}: StructuredDataProps) {
  const siteUrl = getSiteUrl();
  const absolute = (path: string) => (path.startsWith("http") ? path : `${siteUrl}${path}`);

  const organization = {
    "@type": "Organization",
    "@id": `${siteUrl}/#organization`,
    name: "Direct2hub",
    url: siteUrl,
    logo: absolute(logoUrl),
    // Store is India-based and sells in INR to an Indian audience — this is
    // the "GEO" signal search/AI engines use to place the business, distinct
    // from (and in addition to) the <meta name="geo.*"> tags in layout.tsx.
    areaServed: { "@type": "Country", name: "India" },
  };

  const website = {
    "@type": "WebSite",
    "@id": `${siteUrl}/#website`,
    url: siteUrl,
    name: "Direct2hub",
    publisher: { "@id": `${siteUrl}/#organization` },
    inLanguage: "en-IN",
  };

  const product: Record<string, unknown> = {
    "@type": "Product",
    "@id": `${siteUrl}/#product`,
    name: productTitle,
    description: productDescription,
    image: absolute(heroImageUrl),
    brand: { "@id": `${siteUrl}/#organization` },
    offers: {
      "@type": "Offer",
      url: `${siteUrl}/price`,
      priceCurrency: CURRENCY,
      price: PRODUCT_PRICE_INR,
      availability: "https://schema.org/InStock",
    },
  };
  // Only claim a rating once there's at least one real review — an empty
  // aggregateRating (or one padded with zeros) is exactly the kind of
  // structured-data spam Google's guidelines flag.
  if (reviewCount > 0) {
    product.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: reviewAverage,
      reviewCount,
    };
  }

  const graph = { "@context": "https://schema.org", "@graph": [organization, website, product] };

  return (
    <script
      type="application/ld+json"
      // JSON.stringify of server-controlled data only (product/review
      // summary come from the DB, never raw user input) — safe to inline.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
