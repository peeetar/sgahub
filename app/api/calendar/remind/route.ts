import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { remind } from "@/lib/content-calendar";

// Vercel's daily cron (vercel.json). It sends CRON_SECRET as a bearer token, and
// with no secret set this refuses, so it can't be used to spam the board.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET || "";
  const given = Buffer.from(req.headers.get("authorization") || "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (!secret || given.length !== want.length || !timingSafeEqual(given, want)) {
    return NextResponse.json({ ok: false, code: "forbidden", message: "Not for you." }, { status: 403 });
  }
  return NextResponse.json({ ok: true, ...(await remind()) });
}
