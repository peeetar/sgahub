"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type Item = { href: string; label: string; icon: string; soon?: string };

// Modules still to come are listed so everyone can see what the hub will
// cover; they turn into links as they're built.
const ITEMS: Item[] = [
  { href: "/", label: "Overview", icon: "◎" },
  { href: "/calendar", label: "Calendar", icon: "▣" },
  { href: "/tasks", label: "Tasks", icon: "☑" },
  { href: "/meetings", label: "Meetings", icon: "◉" },
  { href: "/merch", label: "Till & merch", icon: "▦" },
  { href: "/supplies", label: "Event supplies", icon: "◫", soon: "Snacks, drinks and BBQ stock, with a how-much-to-buy planner" },
  { href: "/finance", label: "Finance", icon: "€" },
  { href: "/kiosk", label: "Coffee kiosk", icon: "☕" },
  { href: "/marketing", label: "Marketing", icon: "✦" },
  { href: "/reports", label: "Year-end report", icon: "▧", soon: "PDF report for the last meeting of the year" },
  { href: "/people", label: "People", icon: "◍" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export default function Nav({ email, overdue = 0 }: { email: string; overdue?: number }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const on = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));
  return (
    <aside className={"side-nav" + (open ? " is-open" : "")}>
      <div className="side-nav__top">
        <Link href="/" className="brand" onClick={() => setOpen(false)}><span className="brand__mark">SGA</span> Hub</Link>
        <button className="side-nav__burger" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Menu">{open ? "×" : "☰"}</button>
      </div>
      <nav className="side-nav__list">
        {ITEMS.map((it) => it.soon ? (
          <span key={it.href} className="navitem navitem--soon" title={it.soon}>
            <i aria-hidden="true">{it.icon}</i>{it.label}<small>soon</small>
          </span>
        ) : (
          <Link key={it.href} href={it.href} className={"navitem" + (on(it.href) ? " is-on" : "")} onClick={() => setOpen(false)}>
            <i aria-hidden="true">{it.icon}</i>{it.label}
            {it.href === "/tasks" && overdue > 0 && <b className="navitem__badge" title={`${overdue} overdue`}>{overdue > 99 ? "99+" : overdue}</b>}
          </Link>
        ))}
        <a href="/pos" className="navitem navitem--till"><i aria-hidden="true">▶</i>Open the till</a>
      </nav>
      <form method="post" action="/api/auth/logout" className="side-nav__me">
        <Link href="/account" title="Account and password" onClick={() => setOpen(false)}>{email}</Link>
        <button className="linkbtn linkbtn--light">Sign out</button>
      </form>
    </aside>
  );
}
