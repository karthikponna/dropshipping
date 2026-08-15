import type { FileMap, PageFramework, PageType } from "@/lib/types";

import { landingFramework } from "./landing";
import { productFramework } from "./product";

export { landingFramework, LANDING_COMPONENTS, LANDING_REQUIRED_FILES } from "./landing";
export { productFramework, PRODUCT_COMPONENTS, PRODUCT_REQUIRED_FILES } from "./product";

export const FRAMEWORKS: Record<PageType, PageFramework> = {
  landing: landingFramework,
  product: productFramework,
};

export function getFramework(pageType: PageType): PageFramework {
  return FRAMEWORKS[pageType];
}

/** Required files the model did not emit. Empty array means the tree is complete. */
export function missingRequiredFiles(pageType: PageType, files: FileMap): string[] {
  const framework = getFramework(pageType);
  return framework.requiredFiles.filter((path) => {
    const contents = files[path];
    return typeof contents !== "string" || contents.trim().length === 0;
  });
}

/**
 * The manifest rendered as prompt text. Drop this into the system prompt so the
 * model fills exactly these slots.
 */
export function renderFrameworkBrief(pageType: PageType): string {
  const framework = getFramework(pageType);

  const files = framework.requiredFiles.map((path) => `- ${path}`).join("\n");

  const components = framework.components
    .map((component) => {
      const requirements = component.requirements.map((line) => `    - ${line}`).join("\n");
      return [
        `- ${component.path} — ${component.purpose}`,
        `    ${component.signature}`,
        requirements,
      ].join("\n");
    })
    .join("\n");

  const guidance = framework.promptGuidance.map((line) => `- ${line}`).join("\n");

  return [
    `PAGE TYPE: ${framework.label} (${framework.pageType})`,
    framework.description,
    "",
    "REQUIRED FILES — emit every one of these, and nothing else:",
    files,
    "",
    `COMPOSITION ORDER inside ${framework.entryFile}:`,
    framework.composition.join(" → "),
    "",
    "COMPONENT SLOTS:",
    components,
    "",
    "RULES:",
    guidance,
  ].join("\n");
}
