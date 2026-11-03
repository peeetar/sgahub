"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/kiosk", label: "Status" },
  { href: "/kiosk/sell", label: "Sell" },
  { href: "/kiosk/students", label: "Students" },
  { href: "/kiosk/stock", label: "Stock" },
  { href: "/kiosk/signups", label: "Sign-ups" },
  { href: "/kiosk/upkeep", label: "Upkeep" },
  { href: "/kiosk/alerts", label: "Alerts" },
  { href: "/kiosk/cash", label: "Cash" },
  { href: "/kiosk/sales", label: "Sales" },
  { href: "/kiosk/system", label: "System" },
  { href: "/kiosk/log", label: "Log" },
];

export default function KioskTabs() {
  const path = usePathname();
  const on = (href: string) => (href === "/kiosk" ? path === href : path === href || path.startsWith(href + "/"));
  return (
    <nav className="subnav" aria-label="Coffee kiosk">
      {TABS.map((t) => <Link key={t.href} href={t.href} className={"subnav__item" + (on(t.href) ? " is-on" : "")}>{t.label}</Link>)}
    </nav>
  );
}
