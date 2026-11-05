import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { notionConfigured } from "@/lib/notion";
import { syncNotion } from "@/lib/tasks";

// Vercel's daily cron (vercel.json): reads the open action items from the
// latest meeting notes in Notion. Like the calendar reminder it needs
// CRON_SECRET, sent as a bearer token, and refuses without it.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET || "";
  const given = Buffer.from(req.headers.get("authorization") || "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (!secret || given.length !== want.length || !timingSafeEqual(given, want)) {
    return NextResponse.json({ ok: false, code: "forbidden", message: "Not for you." }, { status: 403 });
  }
  if (!notionConfigured()) return NextResponse.json({ ok: true, skipped: "Notion isn't set up." });
  try {
    return NextResponse.json({ ok: true, ...(await syncNotion(3)) });
  } catch (err) {
    console.error("tasks sync", err);
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
