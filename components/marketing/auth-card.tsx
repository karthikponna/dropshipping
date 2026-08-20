import Link from "next/link";

import { AuthShowcase } from "./auth-showcase";
import { cx } from "./cx";
import { Eyebrow, MonoLabel } from "./eyebrow";
import { CornerFrame, DotGrid } from "./frame";
import { Logo } from "./logo";

/**
 * Centred auth card sitting inside a dashed blueprint frame. Shared by
 * /login and /signup so the two pages cannot drift apart.
 *
 * `showcase` adds the halftone panel beside the card on large screens. It is
 * opt-in rather than automatic: signup's job is to get out of the way, and two
 * pages that both open with a full-height animation would make the switch
 * between them feel like a page reload.
 */
export function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
  showcase = false,
}: {
  eyebrow: string;
  title: React.ReactNode;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  showcase?: boolean;
}) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden">
      <DotGrid />

      <header className="relative border-b border-sm-border-light bg-white/85 backdrop-blur-[6px]">
        <div className="sm-container flex h-[57px] items-center gap-4">
          <Link href="/" aria-label="DropShipping home">
            <Logo />
          </Link>
        </div>
      </header>

      <main
        className={cx(
          "relative flex flex-1 px-4 py-12 md:py-16",
          showcase
            ? "mx-auto w-full max-w-[1180px] items-stretch justify-center gap-10 lg:gap-14"
            : "items-center justify-center",
        )}
      >
        {showcase ? <AuthShowcase /> : null}

        <div
          className={cx(
            "w-full max-w-[452px]",
            showcase ? "flex shrink-0 flex-col justify-center" : null,
          )}
        >
          <CornerFrame className="p-2.5">
            <div className="border border-sm-border bg-white p-6 sm:p-8">
              <Eyebrow marker>{eyebrow}</Eyebrow>
              <h2 className="mt-5 text-[30px] leading-[1.08]">{title}</h2>
              <p className="mt-3 text-[14.5px]">{subtitle}</p>
              <div className="mt-7">{children}</div>
            </div>
          </CornerFrame>

          <div className="mt-6 text-center">{footer}</div>
        </div>
      </main>
    </div>
  );
}

/** Switch line between the two auth pages. */
export function AuthSwitch({
  prompt,
  href,
  label,
}: {
  prompt: string;
  href: string;
  label: string;
}) {
  return (
    <p className="font-sm-body text-[14.5px] text-sm-text-muted">
      {prompt}{" "}
      <Link
        href={href}
        className="font-medium text-sm-blue underline decoration-sm-blue/30 underline-offset-4 transition-colors duration-[180ms] ease-sm-out-strong hover:decoration-sm-blue motion-reduce:transition-none"
      >
        {label}
      </Link>
    </p>
  );
}

const INPUT =
  "h-11 w-full border border-sm-border bg-white px-3.5 font-sm-body text-[14.5px] text-sm-text transition-colors duration-[180ms] ease-sm-out-strong placeholder:text-sm-text-dim hover:border-sm-border-strong focus:border-sm-blue motion-reduce:transition-none";

export function AuthField({
  id,
  name,
  label,
  type,
  autoComplete,
  required = false,
  placeholder,
  hint,
  minLength,
}: {
  id: string;
  name: string;
  label: string;
  type: "text" | "email" | "password";
  autoComplete: string;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  minLength?: number;
}) {
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor={id}
          className="font-sm-mono text-[11px] leading-none font-medium tracking-[0.14em] text-sm-text-muted uppercase"
        >
          {label}
        </label>
        {required ? null : <MonoLabel>Optional</MonoLabel>}
      </div>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        placeholder={placeholder}
        minLength={minLength}
        aria-describedby={hintId}
        className={INPUT}
      />
      {hint ? (
        <MonoLabel id={hintId} className="block">
          {hint}
        </MonoLabel>
      ) : null}
    </div>
  );
}

/** Inline failure from the action state. Monochrome — blue stays the accent. */
export function AuthError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex gap-3 border border-sm-text bg-sm-paper px-3.5 py-3 font-sm-body text-[13.5px] text-sm-text"
    >
      <span className="mt-[3px] shrink-0 font-sm-mono text-[10.5px] font-medium tracking-[0.18em] uppercase">
        Error
      </span>
      <span>{message}</span>
    </p>
  );
}

/** The "check your email" path signUpAction returns when confirmation is on. */
export function AuthNotice({ message, className }: { message: string; className?: string }) {
  return (
    <p
      role="status"
      className={cx(
        "flex gap-3 border border-sm-blue bg-sm-blue-tint px-3.5 py-3 font-sm-body text-[13.5px] text-sm-text",
        className,
      )}
    >
      <span className="mt-[3px] shrink-0 font-sm-mono text-[10.5px] font-medium tracking-[0.18em] text-sm-blue uppercase">
        Next
      </span>
      <span>{message}</span>
    </p>
  );
}
