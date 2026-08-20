"use client";

import Link from "next/link";
import { useState } from "react";

import { GhostLink, SplitLink } from "./buttons";
import { cx } from "./cx";
import { Logo } from "./logo";

const NAV = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#page-types", label: "Page types" },
] as const;

const NAV_LINK =
  "font-sm-body text-[14px] font-medium tracking-[-0.005em] text-sm-text-muted transition-colors duration-[180ms] ease-sm-out-strong hover:text-sm-text motion-reduce:transition-none";

/** Sticky 57px bar: logo left, nav centre, ghost Login and split CTA right. */
export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-sm-border-light bg-white/85 backdrop-blur-[6px]">
      <div className="sm-container flex h-[57px] items-center justify-between gap-6">
        <Link href="/" aria-label="DropShipping home" className="shrink-0">
          <Logo />
        </Link>

        <nav aria-label="Sections" className="hidden items-center gap-7 md:flex">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className={NAV_LINK}>
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <GhostLink href="/login" className="hidden sm:inline-flex">
            Log in
          </GhostLink>
          <SplitLink href="/signup" label="Get started" size="nav" />
          <button
            type="button"
            aria-expanded={open}
            aria-controls="marketing-mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((value) => !value)}
            className="inline-flex h-10 w-10 items-center justify-center border border-sm-border-light bg-white text-sm-text transition-colors duration-[180ms] ease-sm-out-strong hover:border-sm-blue hover:text-sm-blue motion-reduce:transition-none md:hidden"
          >
            <span aria-hidden="true" className="flex h-[11px] w-[15px] flex-col justify-between">
              <span className="block h-px w-full bg-current" />
              <span className={cx("block h-px w-full bg-current", open && "opacity-0")} />
              <span className="block h-px w-full bg-current" />
            </span>
          </button>
        </div>
      </div>

      {open ? (
        <nav
          id="marketing-mobile-nav"
          aria-label="Sections"
          className="border-t border-sm-border-light bg-white md:hidden"
        >
          <ul className="sm-container flex flex-col py-2">
            {NAV.map((item) => (
              <li key={item.href} className="border-b border-dashed border-sm-border-dashed last:border-b-0">
                <a
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="block py-3 font-sm-body text-[15px] font-medium text-sm-text"
                >
                  {item.label}
                </a>
              </li>
            ))}
            <li className="pt-3 pb-2 sm:hidden">
              <GhostLink href="/login" className="w-full">
                Log in
              </GhostLink>
            </li>
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
