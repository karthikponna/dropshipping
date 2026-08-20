import { getFramework } from "@/lib/framework";
import { getComponentInventory, getRelatedPaths, getSessionHistory } from "@/lib/hydra";
import { describeShops } from "@/lib/hydra/concepts";
import { GenerationError } from "@/lib/types";
import type {
  FileMap,
  GenerateRequestBody,
  Investigation,
  PageType,
  RecalledProjectContext,
  RecalledSource,
  SessionTurn,
} from "@/lib/types";

import { INVESTIGATION_MAX_ROUNDS, INVESTIGATION_MAX_TOKENS, INVESTIGATION_TIMEOUT_MS } from "./model";
import {
  INSPECTION_TOOLS,
  MAX_PAST_FILES_PER_INVESTIGATION,
  PAST_TOOL_NAMES,
  PAST_WORK_TOOLS,
  TOOL_NAMES,
  runToolCall,
  type PastWorkContext,
  type ToolContext,
  type ToolSpec,
} from "./tools";

/**
 * The turn where Claude interrogates memory before writing anything.
 *
 * It runs in two situations, for the same underlying reason: the instruction
 * points at something that is not in it.
 *
 * **Before a refinement.** "Make the hero bigger" is self-contained; "now make
 * that narrower" is not, and neither is "put it back the way it was two changes
 * ago". The generation stream carries no transcript, so without something to
 * consult, every refinement is answered as though it were the first thing the
 * user ever said. The graph has been recording each turn as a `Generation` node
 * and each file as a `Component` node since the beginning, so the history is
 * there — it just has to be asked for. What the model chooses to open becomes
 * the file set the writing turn is shown.
 *
 * **Before a create turn that reaches backwards.** "Create a site the same as
 * yesterday's, just change the name" is a request to copy a page nobody has
 * loaded. Recall can name the shop; only reading its components can reproduce
 * it. So the model gets the list of past shops with their dates, picks the one
 * the user means, and opens the files the new page has to be modelled on —
 * which then travel into the writing prompt as reference source.
 *
 * Everything here is best-effort. A graph that is empty, unreachable or slow,
 * or a database that will not hand over the old files, returns null and the
 * generation proceeds exactly as it did before.
 */

/* ─────────────────────────── injected model call ───────────────────────── */

export interface InvestigationLoopParams {
  system: string;
  userMessage: string;
  tools: readonly ToolSpec[];
  maxTokens: number;
  maxRounds: number;
  dispatch: (call: { name: string; input: unknown }) => Promise<{ content: string; isError: boolean }>;
  onToolCall?: (name: string, input: unknown) => void;
  signal?: AbortSignal;
}

/** Structurally `runToolLoop` with the client and model already bound. */
export type InvestigationLoop = (
  params: InvestigationLoopParams,
) => Promise<{ text: string; toolCalls: number }>;

/* ────────────────────────────── the prompt ─────────────────────────────── */

const INVESTIGATION_SYSTEM = [
  "You are about to make one change to a shop page that already exists. Before it is written, work out",
  "exactly what it touches.",
  "",
  "You have read-only access to the memory graph for this shop: every turn of this sitting, every",
  "component of the page, and the imports between them. Use it. The instruction you are given is often",
  "not self-contained — it says 'that section', 'the colour from before', 'undo the last change' — and",
  `${TOOL_NAMES.history} is the only record of what those refer to.`,
  "",
  "How to work:",
  `- Call ${TOOL_NAMES.history} and ${TOOL_NAMES.components} first, in the same turn.`,
  `- Then ${TOOL_NAMES.read} on the files the change actually touches, and ${TOOL_NAMES.related} if you`,
  "  need to know what those files depend on.",
  "- Read as few files as will do. Whatever you read is what the writing step is shown; reading the whole",
  "  page throws away the point of looking.",
  "",
  "Then reply with a short brief for whoever writes the change. No preamble, no headings, under 150 words:",
  "- What the user is actually asking for, resolved against the session history.",
  "- Which files change, and what changes in each.",
  "- Anything already established that the change must not break: an existing helper, a colour, a spacing",
  "  scale, a decision from an earlier turn.",
  "",
  "You are not writing the code. Do not output components, JSX or file blocks.",
].join("\n");

function buildInvestigationMessage(
  pageType: PageType,
  instruction: string,
  history: readonly SessionTurn[],
): string {
  const framework = getFramework(pageType);
  const turn = history.length + 1;

  return [
    `Page being edited: the ${framework.label.toLowerCase()}.`,
    `This is change number ${turn} in this sitting.`,
    "",
    "The user asked for:",
    instruction.trim(),
  ].join("\n");
}

/**
 * The turn that reads an earlier shop instead of the current one.
 *
 * Written as its own contract rather than as a mode flag on the one above,
 * because almost nothing is shared: there is no current tree, no sitting to
 * have a history, and the output is not "which of these files does this touch"
 * but "which of somebody else's files is this a copy of".
 */
const PAST_WORK_SYSTEM = [
  "You are about to build a new shop page from scratch, and the request reaches back at something this",
  "user already built. Before it is written, work out exactly what carries over.",
  "",
  "You have read-only access to their earlier shops: which ones exist, when each page was written, the",
  "components of each, and the source of those components as they were actually written.",
  "",
  "How to work:",
  `- Call ${PAST_TOOL_NAMES.shops} first. Decide which shop the request means. What the request says the`,
  "  shop WAS decides it — its product, its domain, its name. A request naming the candle shop means the",
  "  candle shop. That list arrives ordered on exactly that, and a shop it means carries",
  "  `matches_request`.",
  "- Dates are the weaker signal, not the sharper one. People are precise about what they sold and loose",
  "  about when: 'yesterday' means 'recently', and someone working past midnight says it about this",
  "  morning's work. Use `days_ago` to choose between shops the request describes equally well, or when",
  "  it describes none of them — never to reject one it describes. `days_ago: 0` disqualifies nothing.",
  `- Then ${PAST_TOOL_NAMES.components} on the shop and page you settled on, and ${PAST_TOOL_NAMES.read}`,
  "  on every component it listed, in a single call, entry file first.",
  `- The ceiling is ${MAX_PAST_FILES_PER_INVESTIGATION} files, which is a whole page and then some. Do not`,
  "  economise against it. The writing step rebuilds the page from exactly the files you opened, so a",
  "  section you skip is a section it writes from your description of it — which is how a request for the",
  "  same page comes back as a different one. Read fewer only when the request asks for one part of that",
  "  page rather than the look of all of it.",
  "",
  "Then reply with a short brief for whoever writes the new page. They are handed every file you opened, so",
  "do not retell what is in them — a section-by-section description of a layout they can already read is",
  "wasted. No preamble, no headings, under 150 words:",
  "- Which past shop this is, named, with the date that identifies it, and which files you opened.",
  "- What the new request changes, written as edits to that source: which file, and what in it. A rename is",
  "  never one file — the brand is in the nav, the hero, the footer, the copy and the page metadata.",
  "- Anything in those files that must survive the edit untouched, and anything you could not read.",
  "",
  "You are not writing the code. Do not output components, JSX or file blocks.",
].join("\n");

function buildPastWorkMessage(
  pageType: PageType,
  instruction: string,
  recalled: RecalledProjectContext,
): string {
  const framework = getFramework(pageType);
  const dated = recalled.timePhrase ? `, which they placed at ${recalled.timePhrase}` : "";

  return [
    `Page being built: a new ${framework.label.toLowerCase()}, from nothing.`,
    `The strongest match for what the request points back at is "${recalled.name}"${dated},`,
    `project id ${recalled.projectId}. Confirm that against the dates before you rely on it.`,
    "",
    "The user asked for:",
    instruction.trim(),
  ].join("\n");
}

/** The status line shown while a tool call is in flight. */
function describeToolCall(name: string, input: unknown): string {
  const paths =
    typeof input === "object" && input !== null && Array.isArray((input as { paths?: unknown }).paths)
      ? ((input as { paths: unknown[] }).paths.filter((path) => typeof path === "string") as string[])
      : [];

  switch (name) {
    case TOOL_NAMES.history:
      return "Reading this session's earlier changes…";
    case TOOL_NAMES.components:
      return "Listing the components of this page…";
    case TOOL_NAMES.related:
      return "Checking what those files depend on…";
    case TOOL_NAMES.read:
      return paths.length > 0 ? `Reading ${paths.join(", ")}…` : "Reading the current source…";
    case PAST_TOOL_NAMES.shops:
      return "Looking through the shops you built before…";
    case PAST_TOOL_NAMES.components:
      return "Listing that shop's components…";
    case PAST_TOOL_NAMES.read:
      return paths.length > 0
        ? `Reading ${paths.join(", ")} from that shop…`
        : "Reading that shop's source…";
    default:
      return "Consulting the memory graph…";
  }
}

/* ──────────────────────────── context selection ────────────────────────── */

/**
 * Turns "the files Claude opened" into "the files the writing turn is shown".
 *
 * The entry file joins the set unconditionally. A change that adds or removes a
 * section has to be wired in there, and an investigation focused on the section
 * itself will not always have thought to open it — a missing entry file is a
 * page that silently loses the thing that was just built.
 *
 * Returns null when narrowing would not help, which is the same rule the
 * heuristic path uses: showing seven of eight files saves nothing and risks
 * dropping the one that mattered.
 */
export function contextPathsFrom(read: readonly string[], pageType: PageType, files: FileMap): string[] | null {
  if (read.length === 0) return null;

  const available = Object.keys(files);
  const selected = new Set(read.filter((path) => files[path] !== undefined));
  if (selected.size === 0) return null;

  const entry = getFramework(pageType).entryFile;
  if (files[entry] !== undefined) selected.add(entry);

  if (selected.size >= available.length - 1) return null;

  return [...selected].sort();
}

/* ─────────────────────────────── the step ──────────────────────────────── */

export interface InvestigateParams {
  body: GenerateRequestBody;
  /**
   * The shop cross-session recall resolved, on a create turn that reached
   * backwards. Its project id is what the past-work tools are pointed at, which
   * is why recall has to run before this and not after.
   */
  recalled?: RecalledProjectContext | null;
  /** Surfaces what the model is looking at, one line at a time. */
  onStatus: (message: string) => void;
  signal?: AbortSignal;
}

export type Investigate = (params: InvestigateParams) => Promise<Investigation | null>;

/**
 * Opens the reads that reach outside this generation.
 *
 * Injected rather than imported, for the same reason the Anthropic client is:
 * past source comes out of Postgres through `next/headers`, and this file has
 * to stay importable by an offline test and by a script with no request to read
 * cookies from. `lib/ai/past-project.ts` supplies the real one.
 */
export type PastWorkResolver = (input: {
  recalled: RecalledProjectContext;
  pageType: PageType;
}) => Promise<PastWorkContext | null>;

export function createInvestigator(
  runLoop: InvestigationLoop,
  pastWork?: PastWorkResolver,
): Investigate {
  return async (params): Promise<Investigation | null> => {
    if (params.body.mode === "create") {
      return investigatePastWork(runLoop, pastWork, params);
    }
    return investigateCurrentPage(runLoop, params);
  };
}

/**
 * Runs a tool loop under a deadline, swallowing everything but a cancellation.
 *
 * The investigation must never be what makes a generation fail: it is an
 * optimisation on the prompt, and a prompt without it still builds a site.
 */
async function runInvestigation(
  runLoop: InvestigationLoop,
  {
    system,
    userMessage,
    tools,
    context,
    read,
    onStatus,
    signal,
    onPastRead,
  }: {
    system: string;
    userMessage: string;
    tools: readonly ToolSpec[];
    context: ToolContext;
    read: string[];
    onStatus: (message: string) => void;
    signal?: AbortSignal;
    onPastRead?: (projectId: string, pageType: PageType, sources: readonly RecalledSource[]) => void;
  },
): Promise<{ text: string; toolCalls: number } | null> {
  const deadline = AbortSignal.timeout(INVESTIGATION_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([deadline, signal]) : deadline;

  try {
    return await runLoop({
      system,
      userMessage,
      tools,
      maxTokens: INVESTIGATION_MAX_TOKENS,
      maxRounds: INVESTIGATION_MAX_ROUNDS,
      dispatch: async ({ name, input }) => {
        const outcome = await runToolCall({ name, input, context, alreadyRead: read });
        for (const path of outcome.read) {
          if (!read.includes(path)) read.push(path);
        }
        if (outcome.past) {
          onPastRead?.(outcome.past.projectId, outcome.past.pageType, outcome.past.sources);
        }
        return outcome;
      },
      onToolCall: (name, input) => onStatus(describeToolCall(name, input)),
      signal: combined,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw new GenerationError("aborted", "Generation cancelled.", { retryable: false });
    }
    console.warn("[investigate] skipped; writing without it.", error);
    return null;
  }
}

/** The refinement path: this sitting, this page, the files this change touches. */
async function investigateCurrentPage(
  runLoop: InvestigationLoop,
  { body, onStatus, signal }: InvestigateParams,
): Promise<Investigation | null> {
  const files = body.baseFiles;
  if (body.mode !== "refine" || !body.projectId || !files || Object.keys(files).length === 0) {
    return null;
  }

  const sessionId = body.sessionId ?? body.projectId;

  const [history, inventory] = await Promise.all([
    getSessionHistory(sessionId),
    getComponentInventory(body.projectId, body.pageType),
  ]);

  // An empty inventory means the graph has never seen this page — either it is
  // unreachable or the first generation predates it. Either way there is
  // nothing to investigate with, and the heuristic path is still in place.
  if (inventory.length === 0) return null;

  const read: string[] = [];
  const context: ToolContext = {
    files,
    inventory,
    history,
    related: (paths) => getRelatedPaths({ inventory, paths }),
  };

  const result = await runInvestigation(runLoop, {
    system: INVESTIGATION_SYSTEM,
    userMessage: buildInvestigationMessage(body.pageType, body.prompt, history),
    tools: INSPECTION_TOOLS,
    context,
    read,
    onStatus,
    ...(signal ? { signal } : {}),
  });

  if (!result) return null;

  return {
    plan: result.text.trim(),
    contextPaths: contextPathsFrom(read, body.pageType, files),
    history,
    toolCalls: result.toolCalls,
  };
}

/** The create path: an earlier shop, its dates, and the components to copy. */
async function investigatePastWork(
  runLoop: InvestigationLoop,
  pastWork: PastWorkResolver | undefined,
  { body, recalled, onStatus, signal }: InvestigateParams,
): Promise<Investigation | null> {
  // Recall is what names the shop, and it only fires when the prompt actually
  // reaches for one. Without it there is nothing here to look up.
  if (!pastWork || !recalled) return null;

  const past = await pastWork({ recalled, pageType: body.pageType });
  if (!past) return null;

  const read: string[] = [];
  const opened = new Map<string, RecalledSource>();
  let sourceProjectId = recalled.projectId;
  let sourcePageType = body.pageType;

  const context: ToolContext = {
    files: {},
    inventory: [],
    history: [],
    related: async () => [],
    past: { ...past, describedBy: describeShops(past.shops, body.prompt) },
  };

  const result = await runInvestigation(runLoop, {
    system: PAST_WORK_SYSTEM,
    userMessage: buildPastWorkMessage(body.pageType, body.prompt, recalled),
    tools: PAST_WORK_TOOLS,
    context,
    read,
    onStatus,
    ...(signal ? { signal } : {}),
    onPastRead: (projectId, pageType, sources) => {
      // The last page it read from is the one it settled on. A model that
      // looked at the landing page and then the product page means the second.
      sourceProjectId = projectId;
      sourcePageType = pageType;
      for (const source of sources) opened.set(source.path, source);
    },
  });

  if (!result) return null;

  const sources = [...opened.values()].sort((left, right) => left.path.localeCompare(right.path));
  const sourceName =
    past.shops.find((shop) => shop.projectId === sourceProjectId)?.name ??
    (sourceProjectId === recalled.projectId ? recalled.name : "");

  return {
    plan: result.text.trim(),
    contextPaths: null,
    history: [],
    toolCalls: result.toolCalls,
    recalledCode:
      sources.length > 0
        ? { projectId: sourceProjectId, name: sourceName, pageType: sourcePageType, sources }
        : null,
  };
}
