/**
 * Runner for the adapter checks:
 *
 *     node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON lib/preview/run-tests.mjs
 *
 * Node executes the TypeScript sources directly (type stripping); the resolve
 * hook below only teaches it the two things tsconfig knows and Node does not —
 * the `@/*` path alias and extension-less relative imports.
 */

import { register } from "node:module";

register("./resolve-hooks.mjs", import.meta.url);

await import("./toSandpack.test.ts");
await import("./navigation.test.ts");
