import { z } from "zod";
import { isInjection } from "@/server/context/chunker";

export const PACK_FORMAT = "opendot.pack";
export const PACK_VERSION = 1;
export const PACK_MAX_BYTES = 256 * 1024;

export const packSchema = z
  .object({
    format: z.literal(PACK_FORMAT),
    version: z.literal(PACK_VERSION),
    name: z.string().min(1).max(80),
    description: z.string().max(500).default(""),
    author: z.string().max(80).optional(),
    dot: z.object({
      name: z.string().min(1).max(60),
      purpose: z.string().max(300).default(""),
      instructions: z.string().max(8000).default(""),
      look: z.record(z.string(), z.unknown()).optional(),
    }),
    skills: z.array(z.object({ name: z.string().min(1).max(60), description: z.string().max(300), body: z.string().max(8000) })).max(30).default([]),
    routines: z.array(z.object({ name: z.string().min(1).max(60), instruction: z.string().max(2000), schedule: z.string().max(60) })).max(10).default([]),
    // Packs can only make a dot MORE careful. "allow" rules are never accepted from a file.
    rules: z.array(z.object({ action: z.string().min(1).max(300), decision: z.enum(["ask", "never"]) })).max(50).default([]),
    mcp: z.array(z.string().max(60)).max(10).default([]), // preset ids to suggest, never credentials
    modelHint: z.string().max(80).optional(),
  })
  .strict();

export type DotPack = z.infer<typeof packSchema>;

export function parsePack(raw: string): { ok: true; pack: DotPack } | { ok: false; error: string } {
  if (Buffer.byteLength(raw, "utf8") > PACK_MAX_BYTES) return { ok: false, error: "This file is too large to be a dot pack (limit 256 KB)." };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "This is not valid JSON." };
  }
  const res = packSchema.safeParse(json);
  return res.success ? { ok: true, pack: res.data } : { ok: false, error: `Not a valid dot pack: ${res.error.issues[0]?.path.join(".") || "file"}: ${res.error.issues[0]?.message}` };
}

/** Things the user should see before importing. Imported text is untrusted: it becomes part of the dot's prompt. */
export function reviewPack(pack: DotPack): string[] {
  const warnings: string[] = [];
  const texts = [pack.dot.instructions, ...pack.skills.map((s) => s.body), ...pack.routines.map((r) => r.instruction)];
  if (texts.some((t) => isInjection(t))) warnings.push("Contains text that tries to override instructions. Read it before importing.");
  if (pack.skills.some((s) => /\b(curl|wget|powershell|Invoke-WebRequest|rm\s+-rf|del\s+\/|reg\s+add|certutil|bash\s+-c)\b/i.test(s.body))) warnings.push("A skill mentions shell commands. Commands still need your approval to run.");
  if (pack.routines.length) warnings.push(`${pack.routines.length} scheduled routine(s) will be imported turned OFF.`);
  if (texts.some((t) => /https?:\/\//i.test(t))) warnings.push("Contains links. The dot may open them.");
  return warnings;
}
