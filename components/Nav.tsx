"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, Buildings } from "@phosphor-icons/react";

const links = [
  { href: "/", label: "Jobs", icon: Briefcase },
  { href: "/companies", label: "Companies", icon: Buildings },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="nav">
      <div className="max-w-7xl mx-auto px-4 flex gap-6">
        {links.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`nav-link flex items-center gap-1.5 ${active ? "nav-link-active" : ""}`}
            >
              <Icon size={16} weight={active ? "fill" : "regular"} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
