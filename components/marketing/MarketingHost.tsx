"use client";

// Marketing HQ and the calendar draw their own DOM (canvases, sheets, autosave),
// so React only gives them a place to live and tells them when to leave.
import { useEffect, useRef } from "react";
import "./marketing.css";

export default function MarketingHost({ view }: { view: "hq" | "calendar" }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current!;
    let left = false;
    let cleanup: (() => void) | undefined;
    (async () => {
      const [{ toast }, tool] = await Promise.all([import("./ui.js"), view === "hq" ? import("./hq.js") : import("./calendar.js")]);
      if (left) return;
      el.replaceChildren();
      const done = await tool.render(el, { toast });
      if (left) done?.(); else cleanup = done ?? undefined;
    })();
    return () => { left = true; cleanup?.(); el.replaceChildren(); };
  }, [view]);
  return <div ref={root} className="mkroot"><p className="muted">Opening…</p></div>;
}
