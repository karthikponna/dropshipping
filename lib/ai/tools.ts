import { FRAMEWORKS } from "@/lib/framework";
import type { ShopMatch } from "@/lib/hydra/concepts";
import { isPageType } from "@/lib/types";
import type {
  FileMap,
  InventoryEntry,
  PageType,
  PastShop,
  RecalledSource,
  SessionTurn,
} from "@/lib/types";

/**
 * The tools Claude gets before it writes, and the code that answers them.
 *
 * Every one of them is a question about memory. Two sets, because there are two
 * questions worth asking and they are asked at opposite ends of a shop's life:
 *
 * - `INSPECTION_TOOLS`, before a refinement. By the fourth turn of a sitting the
 *   instruction has stopped being self-contained — "now make that narrower"
 *   means nothing without turn two — and the model is the only thing that knows
 *   which earlier turn and which file it is pointing at.
 * - `PAST_WORK_TOOLS`, before a create turn that reaches backwards. "Same as
 *   yesterday, just change the name" needs the shop identified by its date and
 *   its actual components read, neither of which any heuristic can supply.
 *
 * Deliberately free of the Anthropic SDK. `lib/ai/client.ts` maps `ToolSpec`
 * onto the wire format, which keeps the dispatcher runnable in a plain test.
 */

/** A tool as the model sees it, in the SDK's shape but not its types. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** One file the model is allowed to read per call, and in total per turn. */
export const MAX_FILES_PER_READ = 4;
export const MAX_FILES_PER_INVESTIGATION = 6;

/**
 * The same, for a *past* shop, and deliberately not the same numbers.
 *
 * A refinement is hunting for the two or three files one change touches, and a
 * tight budget is what stops it dragging the whole page into the writing turn —
 * that is a different job and its numbers should not move. A create turn
 * copying a page wants the opposite: every file it does not open is a section
 * the writing turn has to invent from prose, which is how "the same UI" becomes
 * a different site. Sized off the frameworks so a whole page fits in a single
 * call, with room left for a look at the other page of the same shop.
 */
const LARGEST_PAGE = Math.max(
  ...Object.values(FRAMEWORKS).map((framework) => framework.requiredFiles.length),
);
export const MAX_PAST_FILES_PER_READ = LARGEST_PAGE;
export const MAX_PAST_FILES_PER_INVESTIGATION = LARGEST_PAGE + 2;

export const TOOL_NAMES = {
  history: "session_history",
  components: "list_components",
  read: "read_files",
  related: "related_files",
} as const;

export const INSPECTION_TOOLS: readonly ToolSpec[] = [
  {
    name: TOOL_NAMES.history,
    description:
      "Earlier turns in this sitting, oldest first: what the user asked for each time and what was built. " +
      "Call this whenever the instruction refers to something that is not in it — 'that section', 'the colour " +
      "you used', 'undo that', 'make it narrower' — because the referent is in an earlier turn.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: TOOL_NAMES.components,
    description:
      "Every component of the page being edited: path, exported name, what the slot is for, line count, and " +
      "whether it is the entry file. Metadata only, no source. Start here to find which file a change belongs in.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: TOOL_NAMES.related,
    description:
      "What the given files import, walked two levels out. Use it before editing a file so you do not " +
      "reinvent a helper it already depends on.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Component paths, exactly as list_components reported them.",
        },
      },
      required: ["paths"],
    },
  },
  {
    name: TOOL_NAMES.read,
    description:
      `Full current source of up to ${MAX_FILES_PER_READ} files. Read only the files the change actually ` +
      "touches — whatever you read is what gets sent to the writing step, so reading the whole page defeats " +
      "the purpose.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Component paths, exactly as list_components reported them.",
        },
      },
      required: ["paths"],
    },
  },
];

/* ──────────────────────────── past work tools ──────────────────────────── */

export const PAST_TOOL_NAMES = {
  shops: "past_shops",
  components: "past_components",
  read: "read_past_files",
} as const;

export const PAST_WORK_TOOLS: readonly ToolSpec[] = [
  {
    name: PAST_TOOL_NAMES.shops,
    description:
      "Every shop this user has built before: its project id, its name, what it sold, which pages it " +
      "has and the date each page was written. Call this first. Shops the request describes come first " +
      "and carry `matches_request`; use that. `days_ago` breaks ties and stands in when the request " +
      "describes no shop at all — it is not an exact match to test, because a user saying 'yesterday' " +
      "means 'recently'.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: PAST_TOOL_NAMES.components,
    description:
      "Every component of one page of one past shop: path, exported name, what the slot is for and line " +
      "count. Metadata only, no source. Use it to see the shape of that page before deciding which files " +
      "are worth reading.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "As past_shops reported it." },
        page_type: {
          type: "string",
          enum: ["landing", "product"],
          description: "Which page of that shop.",
        },
      },
      required: ["project_id", "page_type"],
    },
  },
  {
    name: PAST_TOOL_NAMES.read,
    description:
      `Full source of up to ${MAX_PAST_FILES_PER_READ} components of a past shop, exactly as they were ` +
      "written. Whatever you read is what the writing step rebuilds the new page from, and whatever you " +
      "leave out it has to invent. When the request is for that page's design, pass every path " +
      `${PAST_TOOL_NAMES.components} listed, in one call — the budget is sized for a whole page.`,
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "As past_shops reported it." },
        page_type: {
          type: "string",
          enum: ["landing", "product"],
          description: "Which page of that shop.",
        },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Component paths, exactly as past_components reported them.",
        },
      },
      required: ["project_id", "page_type", "paths"],
    },
  },
];

/* ─────────────────────────────── dispatch ──────────────────────────────── */

/**
 * The reads that reach outside the page being written: other shops, and their
 * source. Absent on a refinement, which only ever looks at the tree it is
 * editing, and absent on a create turn that is not reaching for anything.
 */
export interface PastWorkContext {
  /** Shops the user built before, already read from the graph. */
  shops: readonly PastShop[];
  /**
   * What the request and each shop's own words share, by project id. Absent
   * when nothing in the request describes a shop, which is exactly the case
   * where the dates are all there is to go on.
   */
  describedBy?: ReadonlyMap<string, ShopMatch>;
  /** Now, in epoch ms, so "days ago" is computed from one clock. */
  now: number;
  /** Components of one page of a past shop, from the graph. */
  components: (projectId: string, pageType: PageType) => Promise<InventoryEntry[]>;
  /** Source of one page of a past shop, from Postgres, ownership checked there. */
  source: (projectId: string, pageType: PageType) => Promise<FileMap>;
}

export interface ToolContext {
  /** The tree as the browser last had it — the source of truth for contents. */
  files: FileMap;
  /** Components of the page being edited, already read from the graph. */
  inventory: readonly InventoryEntry[];
  /** Turns already generated in this sitting, already read from the graph. */
  history: readonly SessionTurn[];
  /** Live IMPORTS traversal; injected so the dispatcher stays testable. */
  related: (paths: readonly string[]) => Promise<string[]>;
  /** Set only for a create turn that reaches back at an earlier shop. */
  past?: PastWorkContext;
}

/** Source opened out of an earlier shop, and which page of it came from. */
export interface PastFileRead {
  projectId: string;
  pageType: PageType;
  sources: readonly RecalledSource[];
}

export interface ToolCallOutcome {
  /** JSON, which is what goes back to the model as the tool result. */
  content: string;
  /** Files this call put in front of the model, for the caller to accumulate. */
  read: readonly string[];
  /** Set when the call served source out of a past shop rather than this one. */
  past?: PastFileRead;
  isError: boolean;
}

function ok(value: unknown, read: readonly string[] = []): ToolCallOutcome {
  return { content: JSON.stringify(value), read, isError: false };
}

function fail(message: string): ToolCallOutcome {
  return { content: JSON.stringify({ error: message }), read: [], isError: true };
}

function requestedPaths(input: unknown): string[] | null {
  if (typeof input !== "object" || input === null) return null;
  const paths = (input as { paths?: unknown }).paths;
  if (!Array.isArray(paths)) return null;
  return paths.filter((path): path is string => typeof path === "string" && path.length > 0);
}

/** `{ project_id, page_type }` off a tool input, or null if either is unusable. */
function requestedPage(input: unknown): { projectId: string; pageType: PageType } | null {
  if (typeof input !== "object" || input === null) return null;

  const { project_id: projectId, page_type: pageType } = input as {
    project_id?: unknown;
    page_type?: unknown;
  };
  if (typeof projectId !== "string" || projectId.length === 0) return null;
  if (!isPageType(pageType)) return null;

  return { projectId, pageType };
}

/** Whole days between then and now, which is the unit "yesterday" is said in. */
function daysAgo(then: number, now: number): number {
  if (then <= 0) return 0;
  return Math.max(0, Math.round((now - then) / 86_400_000));
}

/** `2026-08-18`, so the model has an absolute date as well as a relative one. */
function isoDate(epochMs: number): string {
  if (epochMs <= 0) return "";
  return new Date(epochMs).toISOString().slice(0, 10);
}

function describeInventory(inventory: readonly InventoryEntry[]): unknown[] {
  return inventory.map((entry) => ({
    path: entry.path,
    name: entry.name,
    purpose: entry.purpose,
    lines: entry.lineCount,
    ...(entry.isEntry ? { entry: true } : {}),
    ...(entry.isClient ? { clientComponent: true } : {}),
  }));
}

/**
 * Runs one tool call.
 *
 * `alreadyRead` is passed in rather than held here so a caller can enforce a
 * budget across the whole investigation: the model is free to keep asking, but
 * once it has seen enough files the answer is a refusal that tells it to stop
 * looking and write the plan, which is far better behaved than truncating.
 */
export async function runToolCall({
  name,
  input,
  context,
  alreadyRead = [],
}: {
  name: string;
  input: unknown;
  context: ToolContext;
  alreadyRead?: readonly string[];
}): Promise<ToolCallOutcome> {
  switch (name) {
    case TOOL_NAMES.history: {
      if (context.history.length === 0) {
        return ok({ turns: [], note: "This is the first change in this sitting." });
      }
      return ok({
        turns: context.history.map((turn, index) => ({
          turn: index + 1,
          page: turn.pageType,
          mode: turn.mode,
          asked: turn.prompt,
          built: turn.name,
        })),
      });
    }

    case TOOL_NAMES.components: {
      if (context.inventory.length === 0) {
        return ok({ components: [], note: "The graph has no components for this page yet." });
      }
      return ok({ components: describeInventory(context.inventory) });
    }

    case TOOL_NAMES.related: {
      const paths = requestedPaths(input);
      if (paths === null) return fail("`paths` must be an array of strings.");
      if (paths.length === 0) return ok({ imports: [] });

      const related = await context.related(paths);
      return ok({
        imports: related,
        ...(related.length === 0 ? { note: "These files import nothing else in the project." } : {}),
      });
    }

    case TOOL_NAMES.read: {
      const paths = requestedPaths(input);
      if (paths === null) return fail("`paths` must be an array of strings.");

      const budget = MAX_FILES_PER_INVESTIGATION - alreadyRead.length;
      if (budget <= 0) {
        return fail(
          `You have already read ${alreadyRead.length} files, which is the limit. Write the plan with what you have.`,
        );
      }

      const wanted = paths.slice(0, Math.min(MAX_FILES_PER_READ, budget));
      const files: Record<string, string> = {};
      const missing: string[] = [];
      const read: string[] = [];

      for (const path of wanted) {
        const source = context.files[path];
        if (source === undefined) {
          missing.push(path);
          continue;
        }
        files[path] = source;
        if (!alreadyRead.includes(path)) read.push(path);
      }

      if (Object.keys(files).length === 0) {
        return fail(
          `None of those paths exist. Available: ${Object.keys(context.files).sort().join(", ")}`,
        );
      }

      return ok({ files, ...(missing.length > 0 ? { notFound: missing } : {}) }, read);
    }

    case PAST_TOOL_NAMES.shops: {
      const past = context.past;
      if (!past) return fail("There is no earlier work to look at from here.");
      if (past.shops.length === 0) {
        return ok({ shops: [], note: "This user has not built anything in an earlier session." });
      }

      const described = past.describedBy;
      const scoreOf = (projectId: string): number => described?.get(projectId)?.score ?? 0;

      // Described first, newest among equals. The order is the recommendation:
      // a model handed a flat list re-derives the ranking itself, and a date is
      // a much easier thing to over-trust than a description is.
      const ranked = [...past.shops].sort((left, right) => {
        const byMatch = scoreOf(right.projectId) - scoreOf(left.projectId);
        return byMatch !== 0 ? byMatch : right.updatedAt - left.updatedAt;
      });

      return ok({
        today: isoDate(past.now),
        ordered_by: "how well each shop's own description matches the request, then recency",
        shops: ranked.map((shop) => {
          const match = described?.get(shop.projectId);

          return {
            project_id: shop.projectId,
            name: shop.name,
            about: shop.summary,
            ...(match && match.matched.length > 0 ? { matches_request: match.matched } : {}),
            last_worked_on: isoDate(shop.updatedAt),
            days_ago: daysAgo(shop.updatedAt, past.now),
            pages: shop.pages.map((page) => ({
              page_type: page.pageType,
              built_on: isoDate(page.builtAt),
              days_ago: daysAgo(page.builtAt, past.now),
              revisions: page.generations,
            })),
          };
        }),
      });
    }

    case PAST_TOOL_NAMES.components: {
      const past = context.past;
      if (!past) return fail("There is no earlier work to look at from here.");

      const page = requestedPage(input);
      if (page === null) {
        return fail("`project_id` must be a string and `page_type` one of landing, product.");
      }

      const inventory = await past.components(page.projectId, page.pageType);
      if (inventory.length === 0) {
        return ok({
          components: [],
          note: `That shop has no ${page.pageType} page recorded. Try the other page type, or another shop.`,
        });
      }

      return ok({ components: describeInventory(inventory) });
    }

    case PAST_TOOL_NAMES.read: {
      const past = context.past;
      if (!past) return fail("There is no earlier work to look at from here.");

      const page = requestedPage(input);
      if (page === null) {
        return fail("`project_id` must be a string and `page_type` one of landing, product.");
      }
      const paths = requestedPaths(input);
      if (paths === null) return fail("`paths` must be an array of strings.");

      const budget = MAX_PAST_FILES_PER_INVESTIGATION - alreadyRead.length;
      if (budget <= 0) {
        return fail(
          `You have already read ${alreadyRead.length} files, which is the limit. Write the brief with what you have.`,
        );
      }

      // Ownership lives behind this call, in the server-side reader: a project
      // id the model made up resolves to nothing rather than to somebody
      // else's shop.
      const available = await past.source(page.projectId, page.pageType);
      if (Object.keys(available).length === 0) {
        return fail("That shop and page have no saved source. Check past_shops for what exists.");
      }

      const wanted = paths.slice(0, Math.min(MAX_PAST_FILES_PER_READ, budget));
      const files: Record<string, string> = {};
      const sources: RecalledSource[] = [];
      const missing: string[] = [];
      const read: string[] = [];

      for (const path of wanted) {
        const contents = available[path];
        if (contents === undefined) {
          missing.push(path);
          continue;
        }
        files[path] = contents;
        if (!alreadyRead.includes(path)) {
          read.push(path);
          sources.push({ path, contents });
        }
      }

      if (Object.keys(files).length === 0) {
        return fail(
          `None of those paths exist on that page. Available: ${Object.keys(available).sort().join(", ")}`,
        );
      }

      return {
        content: JSON.stringify({ files, ...(missing.length > 0 ? { notFound: missing } : {}) }),
        read,
        past: { projectId: page.projectId, pageType: page.pageType, sources },
        isError: false,
      };
    }

    default:
      return fail(`Unknown tool: ${name}`);
  }
}
