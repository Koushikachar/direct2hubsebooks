import { prisma } from "@/lib/db";
import type { ReviewView, ReviewsSummary } from "@/lib/types";

export function summarizeRatings(ratings: number[]): ReviewsSummary {
  const count = ratings.length;
  const sum = ratings.reduce((a, b) => a + b, 0);
  const average = count ? Math.round((sum / count) * 10) / 10 : 0;
  const breakdown: ReviewsSummary["breakdown"] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of ratings) {
    const key = Math.min(5, Math.max(1, Math.round(r))) as 1 | 2 | 3 | 4 | 5;
    breakdown[key] += 1;
  }
  return { average, count, breakdown };
}

const EMPTY_SUMMARY: ReviewsSummary = { average: 0, count: 0, breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };

export interface ReviewsPage {
  reviews: ReviewView[];
  summary: ReviewsSummary;
  nextCursor: string | null;
}

// Only ever returns genuine reviews that a real buyer submitted. There is
// deliberately no fabricated/seed fallback here: showing invented names,
// ratings or comments as if they were real customer reviews is misleading
// advertising (and a fake-review / consumer-protection risk in most
// jurisdictions, India's Consumer Protection Act included). When the table
// is empty, or the DB isn't reachable yet, the honest answer is "no
// reviews yet" — the homepage and pricing page already render a clean
// "just launched" state for that case instead of a star rating.
export async function getReviewsPage(limit: number, cursor: string | null): Promise<ReviewsPage> {
  try {
    const allRatings = await prisma.review.findMany({ select: { rating: true } });
    if (allRatings.length === 0) return { reviews: [], summary: EMPTY_SUMMARY, nextCursor: null };

    const reviews = await prisma.review.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    const nextCursor = reviews.length === limit ? reviews[reviews.length - 1].id : null;

    return {
      reviews: reviews.map((r): ReviewView => ({
        id: r.id,
        name: r.name,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
        verified: Boolean(r.verifiedSubmissionId),
      })),
      summary: summarizeRatings(allRatings.map((r: { rating: number }) => r.rating)),
      nextCursor,
    };
  } catch {
    return { reviews: [], summary: EMPTY_SUMMARY, nextCursor: null };
  }
}
