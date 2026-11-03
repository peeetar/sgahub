import { NextResponse } from "next/server";
import { applyImport, existingTools, planImport, team } from "@/lib/marketing";
import { body, signedIn } from "../respond";

// `apply: false` previews and writes nothing.
export const POST = (req: Request) => signedIn(async (me) => {
  const { data, apply, overwrite } = await body(req);
  const plan = planImport(data, await team());
  if (!apply) return NextResponse.json({ ok: true, ...plan, existing: await existingTools(Object.keys(plan.docs)) });
  return NextResponse.json({ ok: true, ...(await applyImport(plan, overwrite === true, me.email)) });
});
