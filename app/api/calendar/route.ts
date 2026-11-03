import { NextResponse, type NextRequest } from "next/server";
import { TOOLS } from "@/lib/marketing";
import { STATUSES, addRow, clean, listRows, owners, suggestions } from "@/lib/content-calendar";
import { athensDay } from "@/lib/time";
import { body, refuse, signedIn } from "../marketing/respond";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const GET = (req: NextRequest) => signedIn(async (me) => {
  const today = athensDay(new Date());
  const from = req.nextUrl.searchParams.get("from") || `${today.slice(0, 8)}01`;
  const to = req.nextUrl.searchParams.get("to") || "9999-12-31";
  if (!DAY.test(from) || !DAY.test(to)) return refuse(400, "bad_range", "from and to are YYYY-MM-DD.");
  const [rows, suggested, people] = await Promise.all([listRows(from, to), suggestions(me.email), owners()]);
  return NextResponse.json({ ok: true, rows, suggestions: suggested, owners: people, tools: TOOLS, statuses: STATUSES, today });
});

export const POST = (req: Request) => signedIn(async () => {
  const data = await body(req);
  const { fields, errors } = await clean(data);
  const source = data.source ?? null;
  if (source !== null && (typeof source !== "string" || source.length > 60)) errors.push("source is short text.");
  if (errors.length) return refuse(400, "invalid", errors.join(" "));
  return NextResponse.json({ ok: true, row: await addRow(fields, source as string | null) });
});
