import { FeatureCard, FeatureCardEyebrow, FeatureCardHeading } from "./feature-card";

const STEPS: readonly { title: string; detail: string }[] = [
  {
    title: "Pick a page type",
    detail: "Landing or product. Each one has its own fixed set of sections.",
  },
  {
    title: "Describe the shop",
    detail: "What you sell, who it's for, the mood. One or two sentences is enough.",
  },
  {
    title: "Refine in the builder",
    detail: "Ask for changes; every generation is kept as a version you can restore.",
  },
];

export function HowItWorksCard() {
  return (
    <FeatureCard>
      <FeatureCardEyebrow>How it works</FeatureCardEyebrow>
      <FeatureCardHeading>From one sentence to a finished page</FeatureCardHeading>

      <ul className="mt-5 flex flex-col gap-2">
        {STEPS.map((step) => (
          <li
            key={step.title}
            className="flex items-start gap-3 rounded-amb-panel border border-amb-border bg-amb-card px-3.5 py-3"
          >
            <span
              aria-hidden="true"
              className="mt-1 h-3 w-3 shrink-0 rounded-full bg-amb-info"
            />
            <span className="min-w-0">
              <span className="block text-[14px] font-medium text-amb-foreground">
                {step.title}
              </span>
              <span className="block text-[12px] text-amb-muted-foreground">{step.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </FeatureCard>
  );
}
