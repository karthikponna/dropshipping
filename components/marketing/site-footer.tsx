import Link from "next/link";

import { MonoLabel } from "./eyebrow";
import { Logo } from "./logo";

const COLUMNS = [
  {
    heading: "Product",
    links: [
      { href: "#how-it-works", label: "How it works" },
      { href: "#page-types", label: "Page types" },
      { href: "#features", label: "Features" },
    ],
  },
  {
    heading: "Account",
    links: [
      { href: "/login", label: "Log in" },
      { href: "/signup", label: "Sign up" },
      { href: "/dashboard", label: "Dashboard" },
    ],
  },
] as const;

const STACK = ["Next.js 15", "Tailwind v4", "Supabase", "Claude"] as const;

const FOOTER_LINK =
  "font-sm-body text-[14.5px] text-sm-text-muted transition-colors duration-[180ms] ease-sm-out-strong hover:text-sm-blue motion-reduce:transition-none";

export function SiteFooter() {
  return (
    <footer className="border-t border-sm-border-light bg-sm-paper-blue">
      <div className="sm-container grid gap-10 py-14 md:grid-cols-[1.4fr_repeat(3,1fr)] md:gap-8">
        <div className="max-w-[320px]">
          <Logo />
          <p className="mt-4 text-[14.5px]">
            Describe a shop in plain English. Get a production-ready Next.js and Tailwind
            storefront, previewed live and saved to your dashboard.
          </p>
        </div>

        {COLUMNS.map((column) => (
          <nav key={column.heading} aria-label={column.heading}>
            <MonoLabel>{column.heading}</MonoLabel>
            <ul className="mt-4 flex flex-col gap-2.5">
              {column.links.map((link) => (
                <li key={link.href}>
                  {link.href.startsWith("#") ? (
                    <a href={link.href} className={FOOTER_LINK}>
                      {link.label}
                    </a>
                  ) : (
                    <Link href={link.href} className={FOOTER_LINK}>
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}

        <div>
          <MonoLabel>Stack</MonoLabel>
          <ul className="mt-4 flex flex-col gap-2.5">
            {STACK.map((item) => (
              <li key={item} className="font-sm-body text-[14.5px] text-sm-text-muted">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-dashed border-sm-border-dashed">
        <div className="sm-container flex flex-col gap-2 py-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-sm-body text-[13.5px] text-sm-text-dim">
            © {new Date().getFullYear()} DropShipping
          </p>
          <MonoLabel>describe · generate · preview</MonoLabel>
        </div>
      </div>
    </footer>
  );
}
