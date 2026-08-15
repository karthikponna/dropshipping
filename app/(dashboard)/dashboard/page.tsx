import type { Metadata } from "next";

import { AiDock } from "@/components/dashboard/ai-dock";
import { deriveMetrics, listProjects } from "@/lib/dashboard/data";
import { GreetingStack } from "@/components/dashboard/greeting-stack";
import { HowItWorksCard } from "@/components/dashboard/how-it-works-card";
import { MetricTopline } from "@/components/dashboard/metric-topline";
import { OnboardingCard, type OnboardingStep } from "@/components/dashboard/onboarding-card";
import { RecentProjectsCard } from "@/components/dashboard/recent-projects-card";
import { getStoredAnthropicKeyPreview } from "@/lib/anthropic-key";
import { FRAMEWORKS } from "@/lib/framework";
import type { PageType } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard" };

/** Section list per page type, so the dock's hint stays true to the contract. */
const PAGE_TYPE_HINTS: Record<PageType, string> = {
  landing: FRAMEWORKS.landing.composition.join(" · "),
  product: FRAMEWORKS.product.composition.join(" · "),
};

export default async function DashboardHomePage() {
  const [projects, storedKeyPreview] = await Promise.all([
    listProjects(),
    getStoredAnthropicKeyPreview(),
  ]);

  const metrics = deriveMetrics(projects);
  const hasKey = storedKeyPreview !== null || Boolean(process.env.ANTHROPIC_API_KEY?.trim());

  const steps: readonly OnboardingStep[] = [
    { label: "Add your API key", href: "/dashboard/settings", done: hasKey },
    { label: "Generate your first page", href: "/dashboard", done: metrics.generationCount > 0 },
    {
      label: "Refine it",
      href: projects[0] ? `/dashboard/projects/${projects[0].id}` : "/dashboard/projects",
      done: metrics.generationCount > 1,
    },
  ];

  const statement =
    metrics.projectCount === 0
      ? "Let's build your first shop page."
      : "Let's continue building your shop pages.";

  return (
    <div className="px-4 pt-4 pb-16 sm:px-6 lg:px-8">
      <MetricTopline metrics={metrics} />

      <div className="mt-12 flex flex-col items-center sm:mt-16">
        <GreetingStack hour={new Date().getHours()} statement={statement} />

        <div className="mt-8 w-full max-w-[674px]">
          <AiDock hints={PAGE_TYPE_HINTS} />
        </div>
      </div>

      <div className="mt-[62px] grid gap-5 sm:grid-cols-2 lg:mt-28 xl:grid-cols-3">
        <OnboardingCard steps={steps} />
        <RecentProjectsCard projects={projects} />
        <HowItWorksCard />
      </div>
    </div>
  );
}
