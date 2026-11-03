import { NextResponse } from "next/server";
import { checkDoc, isTool, saveDoc } from "@/lib/marketing";
import { body, refuse, signedIn } from "../../respond";

export const PUT = (req: Request, { params }: { params: Promise<{ tool: string }> }) => signedIn(async (me) => {
  const { tool } = await params;
  if (!isTool(tool)) return refuse(404, "no_tool", `There is no tool called ${tool}.`);
  const { doc, version } = await body(req);
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    return refuse(400, "bad_version", "Send the version you last loaded (0 if it was never saved).");
  }
  checkDoc(tool, doc);
  const { saved, ...row } = await saveDoc(tool, doc, version, me.email);
  if (!saved) return refuse(409, "conflict", `${row.updated_by_name || "Someone"} changed this while you were editing.`, row);
  return NextResponse.json({ ok: true, tool, ...row });
});
