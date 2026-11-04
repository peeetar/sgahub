import { NextResponse } from "next/server";
import { piGet, type PiCapsule } from "@/lib/pi";
import { refuse, signedIn } from "../respond";

export const GET = () => signedIn(async (me) => {
  const res = await piGet<{ capsules: PiCapsule[] }>("/capsules", me.email);
  return res.ok ? NextResponse.json({ ok: true, capsules: res.capsules }) : refuse(502, "kiosk", res.message);
});
