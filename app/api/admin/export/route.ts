import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/adminAuth";
import { csvSafe } from "@/lib/validators";
import { resolveSubmissionFilters } from "@/lib/submissionFilters";
import type { Prisma } from "@prisma/client";

const BATCH_SIZE = 1000;

const EXPORT_SELECT = {
  id: true,
  name: true,
  email: true,
  countryCode: true,
  whatsapp: true,
  paymentStatus: true,
  amountPaise: true,
  payuTxnId: true,
  payuPaymentId: true,
  downloadCount: true,
  paidAt: true,
  createdAt: true,
} as const;

type ExportRow = Prisma.SubmissionGetPayload<{ select: typeof EXPORT_SELECT }>;

// Quotes/escapes a CSV cell AND defuses spreadsheet formula injection: the
// name/email/number columns are typed by anonymous visitors, and a value like
// =HYPERLINK("http://evil","Click") or =cmd|' /C calc'!A0 would otherwise be
// EXECUTED by Excel/Sheets when the admin opens this export. csvSafe() prefixes
// such cells with an apostrophe so they are always treated as plain text.
function csvEscape(value: unknown): string {
  const str = csvSafe(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

// Streams a CSV in fixed-size batches using cursor pagination — this scales
// to millions of rows without ever holding the full dataset in memory
// (unlike building one big .xlsx in RAM). Excel/Google Sheets open CSV
// natively, so this is a true "download as Excel" experience at any scale.
//
// Honors the exact same status/date filters as the Submissions table (see
// lib/submissionFilters.ts) — click "Paid" + "Last 7 days" then download,
// and the CSV contains only those rows, nothing more.
export async function GET(req: Request) {
  const authError = await requireAdmin(req);
  if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });

  const { searchParams } = new URL(req.url);
  const filters = resolveSubmissionFilters(searchParams);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          "Name,Email,Country Code,WhatsApp Number,Payment Status,Amount Paid (INR),Order ID,Payment/Transaction ID,Downloads Used,Paid At,Submitted At\n"
        )
      );

      let cursor: string | undefined = undefined;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const batch: ExportRow[] = await prisma.submission.findMany({
          where: filters.where,
          select: EXPORT_SELECT,
          take: BATCH_SIZE,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          orderBy: { id: "asc" },
        });
        if (batch.length === 0) break;

        const chunk =
          batch
            .map((s: ExportRow) =>
              [
                csvEscape(s.name),
                csvEscape(s.email),
                csvEscape(s.countryCode),
                csvEscape(s.whatsapp),
                csvEscape(s.paymentStatus),
                csvEscape((s.amountPaise / 100).toFixed(2)),
                csvEscape(s.payuTxnId || ""),
                csvEscape(s.payuPaymentId || ""),
                csvEscape(s.downloadCount),
                csvEscape(s.paidAt ? s.paidAt.toISOString() : ""),
                csvEscape(s.createdAt.toISOString()),
              ].join(",")
            )
            .join("\n") + "\n";
        controller.enqueue(encoder.encode(chunk));

        cursor = batch[batch.length - 1].id;
        if (batch.length < BATCH_SIZE) break;
      }
      controller.close();
    },
  });

  const suffix = filters.status !== "all" || filters.range !== "all" ? `-${filters.status}-${filters.range}` : "";

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="direct2hub-submissions${suffix}-${Date.now()}.csv"`,
    },
  });
}
