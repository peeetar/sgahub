import { NextRequest, NextResponse } from "next/server";
import { HUB_COOKIE, cookieOptions, issueSession, normUsername, passwordLogin, rateOk, secretOk } from "@/lib/auth";

/** Personal sign-in: username and password from the People page. */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const { username, password } = await req.json().catch(() => ({ username: "", password: "" }));
  if (typeof username !== "string" || typeof password !== "string" || !username || !password || username.length > 64 || password.length > 200) {
    return NextResponse.json({ ok: false, code: "invalid" }, { status: 400 });
  }
  if (!rateOk("ip:" + ip, 20) || !rateOk("user:" + normUsername(username), 8)) {
    return NextResponse.json({ ok: false, code: "rate_limited" }, { status: 429 });
  }
  if (!secretOk()) return NextResponse.json({ ok: false, code: "misconfigured" }, { status: 503 });
  try {
    const who = await passwordLogin(username, password);
    if (!who) return NextResponse.json({ ok: false, code: "wrong" }, { status: 401 });
    const { value, maxAge } = issueSession(who.email, who.username);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(HUB_COOKIE, value, cookieOptions(maxAge));
    return res;
  } catch (err) {
    console.error("auth login", err);
    return NextResponse.json({ ok: false, code: "server" }, { status: 500 });
  }
}
