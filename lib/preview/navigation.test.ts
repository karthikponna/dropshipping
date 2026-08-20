/**
 * Behavioural test for the sandbox half of preview navigation. Run it with:
 *
 *     node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON lib/preview/run-tests.mjs
 *
 * The interceptor is the one piece of this feature that never runs in our own
 * bundle: it is shipped to the sandbox as source text, compiled by Sandpack, and
 * executed inside a cross-origin iframe where nothing can observe it. Matching
 * the source with a regular expression only proves the characters are present,
 * which is why the whole module is transpiled and run here against a stub DOM
 * instead — a click goes in, a postMessage payload comes out, and the decision
 * about which clicks count is asserted rather than read.
 */

import assert from "node:assert/strict";
import vm from "node:vm";

import ts from "typescript";

import { previewNavigationTarget } from "./navigation";
import { PREVIEW_NAVIGATION_SHIM, SHIM_FILES } from "./shims";

/* ─────────────────────────────── tiny runner ────────────────────────────── */

interface Outcome {
  name: string;
  passed: boolean;
  detail?: string;
}

const outcomes: Outcome[] = [];

function check(name: string, run: () => void): void {
  try {
    run();
    outcomes.push({ name, passed: true });
  } catch (error) {
    outcomes.push({
      name,
      passed: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

/* ──────────────────────────────── the stub DOM ──────────────────────────── */

/**
 * Only the four things the interceptor touches: `closest`, `getAttribute`, the
 * document's click listener and `postMessage` on the frames above it.
 */
class StubElement {
  readonly ancestor: StubAnchor | null;

  constructor(ancestor: StubAnchor | null) {
    this.ancestor = ancestor;
  }

  closest(selector: string): StubAnchor | null {
    return selector === "a" ? this.ancestor : null;
  }
}

class StubAnchor extends StubElement {
  readonly href: string | null;

  constructor(href: string | null) {
    super(null);
    this.href = href;
  }

  closest(selector: string): StubAnchor | null {
    return selector === "a" ? this : null;
  }

  getAttribute(name: string): string | null {
    return name === "href" ? this.href : null;
  }
}

interface PostedMessage {
  payload: unknown;
  origin: string;
}

class StubFrame {
  readonly posted: PostedMessage[] = [];

  postMessage(payload: unknown, origin: string): void {
    this.posted.push({ payload, origin });
  }
}

interface StubMouseEvent {
  target: StubElement | null;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  preventDefault: () => void;
}

type ClickListener = (event: StubMouseEvent) => void;

interface Registration {
  type: string;
  capture: boolean;
}

interface Click {
  prevented: boolean;
  messages: readonly PostedMessage[];
}

interface Harness {
  /** How the interceptor asked to be wired up. */
  registration: Registration;
  /** Clicks a target and reports what the interceptor did about it. */
  click: (target: StubElement | null, overrides?: Partial<StubMouseEvent>) => Click;
  parent: StubFrame;
  top: StubFrame;
}

const TRANSPILED = ts.transpileModule(SHIM_FILES[PREVIEW_NAVIGATION_SHIM], {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

/**
 * Transpiles and runs the shim, then hands back the listener it registered.
 *
 * `sameFrame` collapses `window.parent` and `window.top` onto one object, which
 * is the shape when the preview is not nested; the interceptor is supposed to
 * notice and post once rather than twice.
 */
function install(options: { sameFrame?: boolean } = {}): Harness {
  const parent = new StubFrame();
  const top = options.sameFrame === true ? parent : new StubFrame();
  const frames = options.sameFrame === true ? [parent] : [parent, top];

  const registrations: Registration[] = [];
  const listeners: ClickListener[] = [];

  const sandboxWindow = { parent, top };
  const sandboxDocument = {
    addEventListener(type: string, listener: ClickListener, capture: boolean): void {
      registrations.push({ type, capture });
      listeners.push(listener);
    },
  };

  const exported: { default?: () => void } = {};
  vm.runInNewContext(TRANSPILED, {
    exports: exported,
    module: { exports: exported },
    window: sandboxWindow,
    document: sandboxDocument,
    Element: StubElement,
  });

  assert.equal(typeof exported.default, "function", "the shim has no default export to call");
  exported.default?.();

  assert.equal(registrations.length, 1, "the shim registered more than one listener");
  const registration = registrations[0];
  const listener = listeners[0];

  return {
    registration,
    parent,
    top,
    click(target, overrides = {}) {
      const before = frames.map((frame) => frame.posted.length);
      let prevented = false;
      const event: StubMouseEvent = {
        target,
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
        preventDefault: () => {
          prevented = true;
        },
        ...overrides,
      };

      listener(event);

      const messages = frames.flatMap((frame, index) => frame.posted.slice(before[index]));
      return { prevented, messages };
    },
  };
}

/**
 * A click in an un-nested preview, so one claimed click is one message and the
 * payload can be asserted without deciding which frame it came from.
 */
function clickHref(href: string | null, overrides?: Partial<StubMouseEvent>): Click {
  return install({ sameFrame: true }).click(new StubAnchor(href), overrides);
}

/** The one payload a click is expected to produce. */
function soleMessage(click: Click): { type: unknown; href: unknown } {
  assert.equal(click.messages.length, 1, `expected one message, got ${click.messages.length}`);
  const { payload, origin } = click.messages[0];
  assert.equal(origin, "*", "the sandbox cannot know the app's origin, so it must post to *");
  assert.ok(typeof payload === "object" && payload !== null, "the payload is not an object");
  return payload as { type: unknown; href: unknown };
}

/* ──────────────────────────────── the checks ────────────────────────────── */

check("the interceptor listens for clicks in the capture phase", () => {
  // Bubbling would let a page's own handler stop the event first.
  assert.deepEqual(install().registration, { type: "click", capture: true });
});

check("an in-site path is claimed and posted as the route it resolves to", () => {
  for (const [href, pageType] of [
    ["/", "landing"],
    ["/product", "product"],
  ] as const) {
    const click = clickHref(href);
    assert.equal(click.prevented, true, `${href} was left to the browser`);

    const payload = soleMessage(click);
    assert.equal(payload.href, href);
    assert.equal(
      previewNavigationTarget(payload),
      pageType,
      `${href} did not resolve to the ${pageType} route`,
    );
  }
});

check("a query or a fragment on an in-site path still resolves to its route", () => {
  for (const href of ["/product?variant=2", "/product#specs", "/product/"]) {
    const payload = soleMessage(clickHref(href));
    assert.equal(payload.href, href, "the href is forwarded verbatim, not normalised in the sandbox");
    assert.equal(previewNavigationTarget(payload), "product", href);
  }
});

check("an internal path that is not a route is claimed but resolves to nothing", () => {
  // The sandbox cannot know the route table, so it posts anything rooted and
  // lets the parent decide. Preventing the click is the point: a bare href in a
  // sandbox would otherwise reload the iframe onto a blank document.
  for (const href of ["/checkout", "/collections/all", "/product/2"]) {
    const click = clickHref(href);
    assert.equal(click.prevented, true, `${href} was left to the browser`);
    assert.equal(
      previewNavigationTarget(soleMessage(click)),
      null,
      `${href} resolved to a route that does not exist`,
    );
  }
});

check("an external link is left entirely alone", () => {
  for (const href of [
    "https://example.com/product",
    "http://example.com",
    "//example.com/product",
    "mailto:hello@example.com",
    "tel:+3112345678",
  ]) {
    const click = clickHref(href);
    assert.equal(click.prevented, false, `${href} was hijacked`);
    assert.deepEqual(click.messages, [], `${href} was announced to the app`);
  }
});

check("a fragment keeps scrolling the page it is on", () => {
  for (const href of ["#features", "#pricing", ""]) {
    const click = clickHref(href);
    assert.equal(click.prevented, false, `${href} was hijacked`);
    assert.deepEqual(click.messages, []);
  }
});

check("a relative path is not treated as a route", () => {
  // "product" resolves against the sandbox's own URL, which is not the shop.
  for (const href of ["product", "./product", "../product"]) {
    const click = clickHref(href);
    assert.equal(click.prevented, false, `${href} was hijacked`);
    assert.deepEqual(click.messages, []);
  }
});

check("a click on a child of the anchor still navigates", () => {
  // Real CTAs wrap a span or an svg, so the target is rarely the anchor itself.
  const anchor = new StubAnchor("/product");
  const click = install({ sameFrame: true }).click(new StubElement(anchor));
  assert.equal(click.prevented, true);
  assert.equal(previewNavigationTarget(soleMessage(click)), "product");
});

check("a click on nothing navigable is ignored", () => {
  for (const target of [null, new StubElement(null)]) {
    const click = install().click(target);
    assert.equal(click.prevented, false);
    assert.deepEqual(click.messages, []);
  }
  // An anchor with no href attribute at all.
  const bare = clickHref(null);
  assert.equal(bare.prevented, false);
  assert.deepEqual(bare.messages, []);
});

check("a modified or non-primary click is the browser's to handle", () => {
  for (const overrides of [
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
    { button: 2 },
    { defaultPrevented: true },
  ]) {
    const click = clickHref("/product", overrides);
    assert.equal(click.prevented, false, `${JSON.stringify(overrides)} was hijacked`);
    assert.deepEqual(click.messages, [], `${JSON.stringify(overrides)} was announced`);
  }
});

check("the message reaches both frames above the sandbox, but each only once", () => {
  const nested = install();
  const click = nested.click(new StubAnchor("/product"));
  assert.equal(click.prevented, true);
  assert.equal(nested.parent.posted.length, 1, "Sandpack's wrapper frame was skipped");
  assert.equal(nested.top.posted.length, 1, "the app's own window was skipped");

  // Un-nested, parent and top are the same window and must not be posted twice.
  const flat = install({ sameFrame: true });
  flat.click(new StubAnchor("/product"));
  assert.equal(flat.parent.posted.length, 1, "the same frame was posted to twice");
});

check("an unreachable frame does not swallow the other one's message", () => {
  const harness = install();
  const unreachable = harness.parent as unknown as { postMessage: () => void };
  unreachable.postMessage = () => {
    throw new Error("cross-origin");
  };

  const click = harness.click(new StubAnchor("/product"));
  assert.equal(click.prevented, true);
  assert.equal(harness.top.posted.length, 1, "a throwing frame stopped the surviving one");
});

/* ───────────────────────────────── report ───────────────────────────────── */

const failures = outcomes.filter((outcome) => !outcome.passed);

console.log(
  `\npreview navigation — ${outcomes.length - failures.length}/${outcomes.length} checks passed\n`,
);
for (const outcome of outcomes) {
  console.log(`  ${outcome.passed ? "PASS" : "FAIL"}  ${outcome.name}`);
  if (!outcome.passed) console.log(`        ${outcome.detail}`);
}
console.log("");

if (failures.length > 0) process.exitCode = 1;
