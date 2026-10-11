export type Expect = {
  all?: string[]; // every item must appear (case-insensitive; "re:" prefix = regular expression)
  any?: string[]; // at least one must appear
  none?: string[]; // must NOT appear
};

const escapeRe = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Turns a needle into a regex.
 *  - "re:..." is used as written (case-insensitive).
 *  - A needle that contains a digit is a number-like value: commas/spaces inside it are ignored
 *    ("18499" matches "18,499") and it never matches inside a longer number ("26" does not match "2026").
 *  - Any other needle is a word or phrase and must match on word boundaries
 *    ("March" does not match "from archive" once spaces are removed, which the old scorer allowed).
 */
export function needleRegex(needle: string): RegExp {
  if (needle.startsWith("re:")) return new RegExp(needle.slice(3), "i");
  const flat = needle.replace(/[, ]/g, "");
  if (/\d/.test(needle)) {
    const body = [...flat].map(escapeRe).join("[, ]*");
    const pre = /^\d/.test(flat) ? "(?<![\\d])" : "";
    const post = /\d$/.test(flat) ? "(?![\\d])" : "";
    return new RegExp(pre + body + post, "i");
  }
  const body = needle.split(/\s+/).map((w) => [...w].map(escapeRe).join("")).join("\\s+");
  const pre = /^\w/.test(needle) ? "\\b" : "";
  const post = /\w$/.test(needle) ? "\\b" : "";
  return new RegExp(pre + body + post, "i");
}

/** True when `needle` appears in `answer`. */
export function has(answer: string, needle: string): boolean {
  return needleRegex(needle).test(answer);
}

export function score(answer: string, e: Expect): { pass: boolean; why: string[] } {
  const why: string[] = [];
  for (const n of e.all ?? []) if (!has(answer, n)) why.push(`missing "${n}"`);
  if (e.any?.length && !e.any.some((n) => has(answer, n))) why.push(`none of [${e.any.join(" | ")}] found`);
  for (const n of e.none ?? []) if (has(answer, n)) why.push(`must not contain "${n}"`);
  return { pass: why.length === 0, why };
}

/**
 * A run that never produced a real answer is a harness problem, not a model failure:
 * empty text, a raw tool call printed as text, or a timeout. The runner retries these.
 */
export function harnessError(answer: string, timedOut = false): string | null {
  if (timedOut) return "timeout";
  if (!answer.trim()) return "empty answer";
  if (/<tool_call>|"name"\s*:\s*"[a-z_]+"\s*,\s*"arguments"/i.test(answer)) return "raw tool call in answer";
  return null;
}

/** 95% Wilson interval for a pass rate. Report this next to every percentage you publish. */
export function wilson(pass: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const p = pass / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

/** Do two Wilson intervals overlap? If yes, do not claim a difference. */
export function intervalsOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}
