/**
 * HydraDB-backed memory for the generator.
 *
 * Postgres stores what a project *is*; this graph stores how its pieces relate —
 * which page inherited which design, which component imports which, and which
 * shop a half-remembered prompt is pointing at. Import from here rather than
 * reaching into the modules directly.
 */

export { getHydraConfig, isHydraConfigured, HYDRA_SETUP_HINT, type HydraConfig } from "./config";
export { hydraHealthy } from "./client";
export { extractConcepts, extractTimeCue, referencesPastWork, type Concept, type TimeCue } from "./concepts";
export { buildCodeGraph, type ComponentNode } from "./code-graph";
export { ingestGeneration, themeFingerprint, type IngestGenerationInput } from "./ingest";
export { getComponentInventory, getPastShops, getRelatedPaths, getSessionHistory } from "./inspect";
export {
  getCodeContext,
  getInheritedDesign,
  recallProject,
  type CodeContext,
  type InheritedDesign,
  type RecalledProject,
} from "./retrieve";
