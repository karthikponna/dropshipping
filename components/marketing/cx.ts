/** Minimal class joiner. The marketing subtree has no clsx dependency. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
