import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rateLimit";
import { getReviewsPage } from "@/lib/reviews";
import {
  generateEditToken,
  hashEditToken,
  reviewCookieName,
  reviewCookieOptions,
  extractOrderAccessToken,
} from "@/lib/reviewAuth";
import { cleanSingleLine } from "@/lib/validators";
import type { ReviewView } from "@/lib/types";

const PAGE_SIZE = 8;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit")) || PAGE_SIZE, 100);
  const cursor = searchParams.get("cursor");
  const page = await getReviewsPage(limit, cursor);
  // Public, identical for every visitor → safe for the CDN to cache briefly.
  // max-age=0 keeps browsers revalidating so the admin panel never shows a
  // stale list after editing/deleting a review; the CDN absorbs the traffic.
  return NextResponse.json(page, {
    headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=120" },
  });
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const { success } = await rateLimit(`review-submit:${ip}`, 5, 60 * 60_000); // 5/hour per IP
  if (!success) {
    return NextResponse.json({ error: "Too many reviews submitted. Please try again later." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Honeypot: a real visitor never fills this hidden field in.
  if (typeof body.website === "string" && body.website.length > 0) {
    return NextResponse.json({ error: "Invalid submission." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? cleanSingleLine(body.name, 60) : "";
  const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 600) : "";
  const rating = Number(body.rating);

  if (!name || name.length < 2) {
    return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "Please choose a rating from 1 to 5." }, { status: 400 });
  }
  if (!comment || comment.length < 5) {
    return NextResponse.json({ error: "Please write a short review (at least 5 characters)." }, { status: 400 });
  }

  // Only a verified buyer may post a review — proven by the same access
  // code that unlocked their download, not just a typed email address
  // (which anyone could claim). See lib/reviewAuth.ts.
  const orderToken = extractOrderAccessToken(body.orderCode);
  if (!orderToken) {
    return NextResponse.json(
      { error: "Please paste your order's access code or download link from your confirmation email." },
      { status: 400 }
    );
  }

  const submission = await prisma.submission.findUnique({
    where: { accessToken: orderToken },
    select: { id: true, paymentStatus: true },
  });
  if (!submission || submission.paymentStatus !== "paid") {
    return NextResponse.json(
      { error: "We couldn't verify a completed purchase for that code. Please double-check your confirmation email." },
      { status: 403 }
    );
  }

  const alreadyReviewed = await prisma.review.findUnique({
    where: { verifiedSubmissionId: submission.id },
    select: { id: true },
  });
  if (alreadyReviewed) {
    return NextResponse.json(
      { error: "You've already submitted a review for this order. You can edit your existing review instead." },
      { status: 409 }
    );
  }

  try {
    const editToken = generateEditToken();
    const review = await prisma.review.create({
      data: {
        name,
        rating,
        comment,
        editTokenHash: hashEditToken(editToken),
        verifiedSubmissionId: submission.id,
      },
    });
    const view: ReviewView = {
      id: review.id,
      name: review.name,
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt.toISOString(),
      verified: true,
    };
    // The edit token is handed to the browser as an httpOnly cookie and is
    // never included in the JSON body — page JavaScript (and therefore any
    // injected script) can't read it, but the browser attaches it
    // automatically when this reviewer later edits/deletes their review.
    const res = NextResponse.json({ ok: true, review: view }, { headers: { "Cache-Control": "no-store" } });
    res.cookies.set(reviewCookieName(review.id), editToken, reviewCookieOptions());
    return res;
  } catch (err) {
    // A race where two requests for the same order both pass the check
    // above lands here as a unique-constraint violation — report it the
    // same friendly way instead of a generic 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "You've already submitted a review for this order. You can edit your existing review instead." },
        { status: 409 }
      );
    }
    console.error("Review submit error:", err);
    return NextResponse.json(
      { error: "Couldn't save your review — the database isn't connected yet." },
      { status: 500 }
    );
  }
}
