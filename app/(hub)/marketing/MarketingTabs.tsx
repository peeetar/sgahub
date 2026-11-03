"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [{ href: "/marketing", label: "Marketing HQ" }, { href: "/marketing/calendar", label: "Calendar" }];

export default function MarketingTabs() {
  const path = usePathname();
  return (
    <nav className="subnav" aria-label="Marketing">
      {TABS.map((t) => <Link key={t.href} href={t.href} className={"subnav__item" + (path === t.href ? " is-on" : "")}>{t.label}</Link>)}
    </nav>
  );
}
