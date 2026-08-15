import { DEFAULT_META, normalizeTheme } from "@/lib/types";
import type { FileMap, GenerationEvent, GenerationMeta, Theme } from "@/lib/types";

/**
 * Incremental parser for the streaming file format:
 *
 *   <meta>{json}</meta>
 *   <theme>{json}</theme>
 *   <file path="components/Hero.tsx">…</file>
 *
 * Feed it raw text deltas with `push()`; it returns the `GenerationEvent`s that
 * became true as a result, so files appear in the UI while they are still being
 * written. Call `finish()` once the model stops.
 *
 * Everything here is deliberately dependency-free and synchronous so it can be
 * exercised offline against fixtures split at pathological boundaries. The three
 * cases it is built around:
 *
 *  - a delta may end anywhere, including halfway through `<file pa` or `</fi`,
 *    so nothing is committed until a tag is provably complete;
 *  - the model sometimes wraps a file body in ``` fences, which are stripped;
 *  - trailing prose after the last `</file>` is tolerated and reported as text.
 */

const META_OPEN = "<meta>";
const META_CLOSE = "</meta>";
const THEME_OPEN = "<theme>";
const THEME_CLOSE = "</theme>";
const FILE_CLOSE = "</file>";
const FILE_OPEN_LEAD = "<file";

/** Every tag literal a partially-received `<…>` could still turn into. */
const TAG_PREFIXES: readonly string[] = [
  META_OPEN,
  META_CLOSE,
  THEME_OPEN,
  THEME_CLOSE,
  FILE_OPEN_LEAD,
  FILE_CLOSE,
];

const FILE_OPEN_RE = /^<file\s+path\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))\s*\/?>/;

/** How many trailing whitespace/backtick characters may be withheld from a delta. */
const FENCE_HOLDBACK = 16;

type ParserState = "outside" | "meta" | "theme" | "file";

interface OpenFile {
  path: string;
  /** Everything received between the tags so far, verbatim. */
  raw: string;
  /** What has already gone out as `file_delta`, so the two never disagree. */
  emitted: string;
  /** True while we are still deciding whether the body opens with a ``` fence. */
  sniffing: boolean;
  /** Head of the body, held back while sniffing. */
  head: string;
}

/** Everything the stream produced, available during and after parsing. */
export interface ParserResult {
  files: FileMap;
  meta: GenerationMeta | null;
  theme: Theme | null;
  /** Prose the model emitted outside any tag, whitespace-only runs dropped. */
  text: string;
  /** A tag was still open when the stream ended. */
  truncated: boolean;
  /** The path of the file that was mid-write when the stream ended. */
  truncatedPath: string | null;
}

export class StreamingFileParser {
  private buffer = "";
  private state: ParserState = "outside";
  private file: OpenFile | null = null;
  private readonly emittedFiles: FileMap = {};
  private meta: GenerationMeta | null = null;
  private theme: Theme | null = null;
  private text = "";
  /** Whitespace-only prose, held until real text proves it is worth emitting. */
  private pendingText = "";
  private truncated = false;
  private truncatedPath: string | null = null;
  private finished = false;

  /** Feed one raw text delta. Returns the events it completed, in order. */
  push(chunk: string): GenerationEvent[] {
    if (this.finished || chunk.length === 0) return [];
    this.buffer += chunk;
    const events: GenerationEvent[] = [];
    this.drain(events, false);
    return events;
  }

  /**
   * Close the stream. Flushes trailing prose, and marks the result truncated if
   * a tag was still open — a half-written file is dropped rather than handed on,
   * which routes it straight into the missing-file repair pass.
   */
  finish(): GenerationEvent[] {
    if (this.finished) return [];
    const events: GenerationEvent[] = [];
    this.drain(events, true);
    this.finished = true;
    return events;
  }

  get result(): ParserResult {
    return {
      files: { ...this.emittedFiles },
      meta: this.meta,
      theme: this.theme,
      text: this.text,
      truncated: this.truncated,
      truncatedPath: this.truncatedPath,
    };
  }

  /** Snapshot of the completed files so far. */
  get files(): FileMap {
    return { ...this.emittedFiles };
  }

  /* ─────────────────────────────── machine ─────────────────────────────── */

  private drain(events: GenerationEvent[], final: boolean): void {
    for (;;) {
      const before = `${this.state}\u0000${this.buffer.length}\u0000${this.file?.head.length ?? -1}`;
      if (!this.step(events, final)) return;
      const after = `${this.state}\u0000${this.buffer.length}\u0000${this.file?.head.length ?? -1}`;
      // Defensive: a step that claims progress but changes nothing would spin.
      if (before === after) return;
    }
  }

  /** Advances one tag boundary or one safe run of content. */
  private step(events: GenerationEvent[], final: boolean): boolean {
    switch (this.state) {
      case "outside":
        return this.stepOutside(events, final);
      case "meta":
        return this.stepBlock(events, final, "meta");
      case "theme":
        return this.stepBlock(events, final, "theme");
      case "file":
        return this.stepFile(events, final);
    }
  }

  private stepOutside(events: GenerationEvent[], final: boolean): boolean {
    if (this.buffer.length === 0) return false;

    const lt = this.buffer.indexOf("<");
    if (lt === -1) {
      this.takeText(this.buffer, events);
      this.buffer = "";
      return false;
    }
    if (lt > 0) {
      this.takeText(this.buffer.slice(0, lt), events);
      this.buffer = this.buffer.slice(lt);
      return true;
    }

    const open = FILE_OPEN_RE.exec(this.buffer);
    if (open) {
      const path = (open[1] ?? open[2] ?? open[3] ?? "").trim();
      this.buffer = this.buffer.slice(open[0].length);
      if (path.length === 0) return true;
      this.file = { path, raw: "", emitted: "", sniffing: true, head: "" };
      this.state = "file";
      events.push({ type: "file_start", path });
      return true;
    }

    if (this.buffer.startsWith(META_OPEN)) {
      this.buffer = this.buffer.slice(META_OPEN.length);
      this.state = "meta";
      return true;
    }
    if (this.buffer.startsWith(THEME_OPEN)) {
      this.buffer = this.buffer.slice(THEME_OPEN.length);
      this.state = "theme";
      return true;
    }

    // Stray closing tags: the model occasionally repeats one. Swallow them.
    for (const closer of [FILE_CLOSE, META_CLOSE, THEME_CLOSE]) {
      if (this.buffer.startsWith(closer)) {
        this.buffer = this.buffer.slice(closer.length);
        return true;
      }
    }

    if (this.couldStillBecomeTag(this.buffer)) {
      if (!final) return false;
      this.takeText(this.buffer, events);
      this.buffer = "";
      return false;
    }

    // A `<` that starts nothing we know — prose or inline markup.
    this.takeText("<", events);
    this.buffer = this.buffer.slice(1);
    return true;
  }

  /** True while `candidate` is a prefix of a tag, so more input could complete it. */
  private couldStillBecomeTag(candidate: string): boolean {
    if (TAG_PREFIXES.some((tag) => tag.startsWith(candidate))) return true;
    // `<file path="…` still streaming its attribute.
    return candidate.startsWith(FILE_OPEN_LEAD) && !candidate.includes(">");
  }

  private stepBlock(events: GenerationEvent[], final: boolean, kind: "meta" | "theme"): boolean {
    const closer = kind === "meta" ? META_CLOSE : THEME_CLOSE;
    const end = this.buffer.indexOf(closer);

    let raw: string;
    if (end === -1) {
      if (!final) return false;
      raw = this.buffer;
      this.buffer = "";
      this.truncated = true;
    } else {
      raw = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + closer.length);
    }

    this.state = "outside";
    const parsed = parseJsonObject(raw);
    if (parsed === null) return true;

    if (kind === "meta") {
      this.meta = normalizeMeta(parsed);
      events.push({ type: "meta", meta: this.meta });
    } else {
      this.theme = normalizeTheme(parsed);
      events.push({ type: "theme", theme: this.theme });
    }
    return true;
  }

  private stepFile(events: GenerationEvent[], final: boolean): boolean {
    const file = this.file;
    if (!file) {
      this.state = "outside";
      return true;
    }

    const end = this.buffer.indexOf(FILE_CLOSE);
    if (end !== -1) {
      const body = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + FILE_CLOSE.length);
      this.appendToFile(body, events);
      this.closeFile(events);
      return true;
    }

    const hold = heldBackLength(this.buffer);
    const safe = this.buffer.length - hold;
    if (safe > 0) {
      const body = this.buffer.slice(0, safe);
      this.buffer = this.buffer.slice(safe);
      this.appendToFile(body, events);
      return true;
    }

    if (final) {
      // Unterminated file: drop the partial body and let the repair pass ask for it.
      this.appendToFile(this.buffer, events);
      this.buffer = "";
      this.truncated = true;
      this.truncatedPath = file.path;
      this.file = null;
      this.state = "outside";
      return false;
    }

    return false;
  }

  /* ──────────────────────────── file plumbing ──────────────────────────── */

  private appendToFile(chunk: string, events: GenerationEvent[]): void {
    const file = this.file;
    if (!file || chunk.length === 0) return;

    file.raw += chunk;

    if (!file.sniffing) {
      this.emitFileDelta(chunk, events);
      return;
    }

    file.head += chunk;
    this.sniffFileHead(events);
  }

  /**
   * Decides, before anything is emitted, whether the body opens with blank lines
   * or a ``` fence. Both are dropped; anything else is released as content.
   */
  private sniffFileHead(events: GenerationEvent[]): void {
    const file = this.file;
    if (!file) return;

    for (;;) {
      const nl = file.head.indexOf("\n");

      if (nl === -1) {
        if (file.head.trim().length === 0) return;
        // Could still be the start of a ``` fence line — wait for its newline.
        if (/^[ \t]*`{1,3}[\w+#-]*$/.test(file.head)) return;
        this.releaseHead(file.head, events);
        return;
      }

      const line = file.head.slice(0, nl);
      const rest = file.head.slice(nl + 1);

      if (line.trim().length === 0) {
        file.head = rest;
        continue;
      }
      if (/^[ \t]*```[\w+#-]*[ \t]*$/.test(line)) {
        this.releaseHead(rest, events);
        return;
      }
      this.releaseHead(file.head, events);
      return;
    }
  }

  private releaseHead(content: string, events: GenerationEvent[]): void {
    const file = this.file;
    if (!file) return;
    file.sniffing = false;
    file.head = "";
    this.emitFileDelta(content, events);
  }

  private emitFileDelta(delta: string, events: GenerationEvent[]): void {
    const file = this.file;
    if (!file || delta.length === 0) return;
    file.emitted += delta;
    events.push({ type: "file_delta", path: file.path, delta });
  }

  private closeFile(events: GenerationEvent[]): void {
    const file = this.file;
    this.file = null;
    this.state = "outside";
    if (!file) return;

    const content = canonicaliseFileBody(file.raw);
    if (content.length === 0) return;

    // Make the deltas add up to exactly `content` where the tail was held back.
    if (content.startsWith(file.emitted) && content.length > file.emitted.length) {
      events.push({ type: "file_delta", path: file.path, delta: content.slice(file.emitted.length) });
    }

    this.emittedFiles[file.path] = content;
    events.push({ type: "file_complete", path: file.path, content });
  }

  /**
   * Prose outside any tag. Whitespace is held rather than emitted, so the
   * newlines that merely separate tags never reach the chat rail — but the spaces
   * inside a real sentence survive even when every character arrives separately.
   */
  private takeText(chunk: string, events: GenerationEvent[]): void {
    if (chunk.trim().length === 0) {
      this.pendingText += chunk;
      return;
    }

    const combined = `${this.pendingText}${chunk}`;
    this.pendingText = "";
    const delta = this.text.length === 0 ? combined.replace(/^\s+/, "") : combined;
    if (delta.length === 0) return;

    this.text += delta;
    events.push({ type: "text", delta });
  }
}

/* ─────────────────────────────── helpers ──────────────────────────────── */

/**
 * How much of the tail must be withheld from a `file_delta`: enough to cover a
 * `</file>` split across chunks, plus any trailing whitespace/backtick run that
 * could turn out to be a closing fence. Nothing is lost — a holdback is released
 * as soon as the next chunk proves what it was.
 */
export function heldBackLength(buffer: string): number {
  let hold = 0;

  for (let k = Math.min(FILE_CLOSE.length - 1, buffer.length); k > 0; k -= 1) {
    if (buffer.endsWith(FILE_CLOSE.slice(0, k))) {
      hold = k;
      break;
    }
  }

  let index = buffer.length;
  const floor = Math.max(0, buffer.length - FENCE_HOLDBACK);
  while (index > floor && /[\s`]/.test(buffer.charAt(index - 1))) {
    index -= 1;
  }

  return Math.min(Math.max(hold, buffer.length - index), buffer.length);
}

/**
 * Turns a raw `<file>` body into the canonical file contents: CRLF normalised,
 * leading blank lines and a wrapping ``` fence removed, exactly one trailing
 * newline. Deterministic, so the same payload always reconstructs byte for byte.
 */
export function canonicaliseFileBody(raw: string): string {
  let text = raw.replace(/\r\n/g, "\n");

  text = text.replace(/^[ \t]*\n+/, "");

  const fence = /^[ \t]*```[\w+#-]*[ \t]*\n/.exec(text);
  if (fence) text = text.slice(fence[0].length);

  text = text.replace(/\s+$/, "");
  if (text.endsWith("```")) {
    text = text.replace(/\n?[ \t]*```$/, "").replace(/\s+$/, "");
  }

  return text.length === 0 ? "" : `${text}\n`;
}

/** Pulls the first complete JSON object out of a `<meta>`/`<theme>` body. */
export function parseJsonObject(raw: string): unknown {
  const cleaned = raw.replace(/```[\w+#-]*/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Coerces `<meta>` output, however partial, into a usable GenerationMeta. */
export function normalizeMeta(input: unknown): GenerationMeta {
  if (typeof input !== "object" || input === null) return DEFAULT_META;

  const raw = input as { name?: unknown; summary?: unknown; tagline?: unknown };
  const str = (value: unknown, fallback: string): string =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;

  return {
    name: str(raw.name, DEFAULT_META.name),
    summary: str(raw.summary, DEFAULT_META.summary),
    ...(typeof raw.tagline === "string" && raw.tagline.trim().length > 0
      ? { tagline: raw.tagline.trim() }
      : {}),
  };
}

/**
 * Convenience for non-streaming callers and fixtures: parse a whole payload in
 * one go and get both the events and the result.
 */
export function parseGenerationPayload(payload: string): {
  events: GenerationEvent[];
  result: ParserResult;
} {
  const parser = new StreamingFileParser();
  const events = [...parser.push(payload), ...parser.finish()];
  return { events, result: parser.result };
}
