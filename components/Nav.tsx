"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Jobs" },
  { href: "/companies", label: "Companies" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="max-w-7xl mx-auto px-4 flex gap-6">
        {links.map(({ href, label }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`py-3 text-sm font-medium border-b-2 ${
                active
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
