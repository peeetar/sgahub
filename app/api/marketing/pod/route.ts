import { NextResponse, type NextRequest } from "next/server";
import { piPicture } from "@/lib/pi";
import { signedIn } from "../respond";

// A capsule's picture, through the Hub: the browser never talks to the Pi, and
// a same-origin image is one a canvas can export.
export const GET = (req: NextRequest) => signedIn(async () => {
  const res = await piPicture(req.nextUrl.searchParams.get("path") || "");
  if (!res) return new NextResponse(null, { status: 404 });
  return new NextResponse(res.body, { headers: {
    "Content-Type": res.headers.get("Content-Type") || "image/png",
    "Cache-Control": "private, max-age=3600",
  } });
});
