import { NextResponse } from "next/server";
import { workspace } from "@/lib/marketing";
import { signedIn } from "../respond";

export const GET = () => signedIn(async (me) => NextResponse.json({ ok: true, ...(await workspace(me.email)) }));
