// The marketing routes' shared front door: signed in, JSON out, and a refusal
// the tools can show as it is.
import { NextResponse } from "next/server";
import { currentSession, type Session } from "@/lib/auth";
import { BadDoc } from "@/lib/marketing";

export const refuse = (status: number, code: string, message: string, extra: object = {}) =>
  NextResponse.json({ ok: false, code, message, ...extra }, { status });

export async function signedIn(run: (me: Session) => Promise<Response>): Promise<Response> {
  const me = await currentSession();
  if (!me) return refuse(401, "signed_out", "Sign in again.");
  try {
    return await run(me);
  } catch (err) {
    if (err instanceof BadDoc) return refuse(400, "invalid", err.message);
    console.error("marketing", err);
    return refuse(500, "server", "The Hub couldn't do that. Try again.");
  }
}

export async function body(req: Request): Promise<Record<string, unknown>> {
  const data = await req.json().catch(() => null);
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}
