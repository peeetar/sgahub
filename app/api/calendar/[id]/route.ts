import { NextResponse } from "next/server";
import { clean, deleteRow, updateRow } from "@/lib/content-calendar";
import { body, refuse, signedIn } from "../../marketing/respond";

type Ctx = { params: Promise<{ id: string }> };
const rowId = async ({ params }: Ctx) => {
  const { id } = await params;
  return /^\d{1,9}$/.test(id) ? Number(id) : null;
};
const gone = () => refuse(404, "no_row", "That calendar entry is gone.");

export const PUT = (req: Request, ctx: Ctx) => signedIn(async () => {
  const id = await rowId(ctx);
  if (id === null) return gone();
  const { fields, errors } = await clean(await body(req), true);
  if (errors.length) return refuse(400, "invalid", errors.join(" "));
  const row = await updateRow(id, fields);
  return row ? NextResponse.json({ ok: true, row }) : gone();
});

export const DELETE = (_req: Request, ctx: Ctx) => signedIn(async () => {
  const id = await rowId(ctx);
  if (id === null || !(await deleteRow(id))) return gone();
  return NextResponse.json({ ok: true });
});
