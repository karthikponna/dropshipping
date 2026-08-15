/**
 * Runner for the generation-engine checks:
 *
 *     npm run test:ai
 *
 * Each test file registers the `@/*` alias hook itself and runs on plain Node —
 * no test framework, no network, no Anthropic call. They are imported in
 * dependency order so a failure in the parser reports before the pipeline that
 * builds on it.
 */

await import("./parser.test.mjs");
await import("./framing.test.mjs");
await import("./errors.test.mjs");
await import("./stream-client.test.mjs");
await import("./pipeline.test.mjs");
