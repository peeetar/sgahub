import { NextRequest, NextResponse } from "next/server";
import { HUB_COOKIE, cookieOptions, issueSession, rateOk, sharedPasswordMatches } from "@/lib/auth";

/** The emergency shared password: how the first person gets in before anyone
 *  has a personal login, and a way back in if one is lost. Off unless
 *  HUB_PASSWORD is set (12+ characters). */
export async function POST(req: NextRequest) {
  if (!process.env.HUB_PASSWORD) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 404 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (!rateOk("pw:" + ip, 10)) return NextResponse.json({ ok: false, code: "rate_limited" }, { status: 429 });
  const { password } = await req.json().catch(() => ({ password: "" }));
  if (typeof password !== "string" || !sharedPasswordMatches(password)) {
    return NextResponse.json({ ok: false, code: "wrong_password" }, { status: 401 });
  }
  const { value, maxAge } = issueSession("board (shared password)");
  const res = NextResponse.json({ ok: true });
  res.cookies.set(HUB_COOKIE, value, cookieOptions(maxAge));
  return res;
}
