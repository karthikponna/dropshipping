import Link from "next/link";

import { FeatureCard } from "./feature-card";
import { cx } from "./format";
import { ArrowRightIcon, CheckIcon } from "./icons";

export interface OnboardingStep {
  label: string;
  href: string;
  done: boolean;
}

interface OnboardingCardProps {
  steps: readonly OnboardingStep[];
}

/** Getting-started checklist: 6px pill progress bar, `N of M` tabular counter. */
export function OnboardingCard({ steps }: OnboardingCardProps) {
  const doneCount = steps.filter((step) => step.done).length;
  const percent = steps.length === 0 ? 0 : Math.round((doneCount / steps.length) * 100);
  const nextStep = steps.find((step) => !step.done);

  return (
    <FeatureCard>
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 text-[14px] font-medium tracking-[-0.02em] text-amb-foreground">
          Getting started
        </h2>
        <span className="shrink-0 text-[12px] tabular-nums text-amb-muted-foreground/70">
          {doneCount} of {steps.length}
        </span>
      </div>

      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-amb-muted"
        role="progressbar"
        aria-valuenow={doneCount}
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-label="Setup progress"
      >
        <span
          className="block h-full rounded-full bg-amb-primary transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ul className="mt-4 flex flex-col gap-0.5">
        {steps.map((step) => (
          <li key={step.label}>
            <Link
              href={step.href}
              className="flex h-9 w-full items-center gap-2.5 rounded-amb-row py-1 pr-2 pl-1 transition-colors hover:bg-amb-muted"
            >
              <span
                className={cx(
                  "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px]",
                  step.done
                    ? "border-amb-muted-foreground bg-amb-muted-foreground text-white"
                    : "border-amb-input",
                )}
              >
                {step.done && <CheckIcon className="h-2.5 w-2.5" />}
              </span>
              <span
                className={cx(
                  "min-w-0 flex-1 truncate text-[14px] tracking-[-0.012em]",
                  step.done ? "text-amb-muted-foreground line-through" : "text-amb-foreground",
                )}
              >
                {step.label}
              </span>
              {step === nextStep && (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-amb-row border border-amb-border text-amb-muted-foreground">
                  <ArrowRightIcon className="h-3.5 w-3.5" />
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-auto pt-6 text-[13px] text-amb-muted-foreground">
        {nextStep ? `Next: ${nextStep.label.toLowerCase()}.` : "Setup complete."}
      </p>
    </FeatureCard>
  );
}
