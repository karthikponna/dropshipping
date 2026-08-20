import Link from "next/link";

import { MonoLabel } from "./eyebrow";
import { Logo } from "./logo";

const COLUMNS = [
  {
    heading: "Product",
    links: [
      { href: "#how-it-works", label: "How it works" },
      { href: "#page-types", label: "Page types" },
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

const FOOTER_LINK =
  "font-sm-body text-[14.5px] text-sm-text-muted transition-colors duration-[180ms] ease-sm-out-strong hover:text-sm-blue motion-reduce:transition-none";

/**
 * The name at full width, closing the page off.
 *
 * Sized in `vw` so it spans the viewport at any width, and clipped at the
 * baseline so the descenders run off the bottom edge — that overrun is what
 * makes it read as a printed masthead rather than a very large heading.
 *
 * Decorative and hidden from assistive tech: the name is already in the logo
 * at the top of the footer and in the copyright line directly above it, and a
 * screen reader does not need it a third time.
 */
function Wordmark() {
  return (
    <div aria-hidden="true" className="overflow-clip">
      {/* 16.8vw is the size at which this exact string in Space Grotesk spans
          just under the viewport — measured, not guessed, and it holds at every
          width because vw scales linearly. */}
      <span className="-mb-[0.12em] block translate-y-[0.02em] text-center font-sm-heading text-[16.8vw] leading-[0.8] font-medium tracking-[-0.045em] whitespace-nowrap text-sm-card-blue select-none">
        dropshipping<span className="text-sm-blue/25">.</span>
      </span>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-sm-border-light bg-sm-paper-blue">
      <div className="sm-container grid gap-10 py-14 md:grid-cols-[1.4fr_repeat(2,1fr)] md:gap-8">
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
      </div>

      <div className="border-t border-dashed border-sm-border-dashed">
        <div className="sm-container flex flex-col gap-2 py-5 sm:flex-row sm:items-center">
          <p className="font-sm-body text-[13.5px] text-sm-text-dim">
            © {new Date().getFullYear()} DropShipping
          </p>
        </div>
      </div>

      <Wordmark />
    </footer>
  );
}
