import "server-only";
import crypto from "node:crypto";
import * as repo from "./repo";
import { normalizeLook } from "@/lib/look";
import {
  packSchema,
  parsePack,
  reviewPack,
  PACK_FORMAT,
  PACK_VERSION,
  type DotPack,
} from "@/lib/pack-schema";
import type { RuleDecision } from "@/lib/types";

export function exportPack(dotId: string): string {
  const dot = repo.getDot(dotId);
  if (!dot) throw new Error("Dot not found.");
  const skills = repo.listSkills(dotId).map((s) => ({
    name: s.name,
    description: s.description,
    body: s.body,
  }));
  const routines = repo.listRoutines(dotId).map((r) => ({
    name: r.name,
    instruction: r.instruction,
    schedule: r.schedule,
  }));
  const rules = repo
    .rulesFor(dotId)
    .filter((r) => r.dotId === dotId)
    .filter((r) => r.decision === "ask" || r.decision === "never")
    .map((r) => ({
      action: r.action,
      decision: r.decision as "ask" | "never",
    }));

  const packData: DotPack = {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    name: dot.name,
    description: dot.purpose,
    author: "User",
    dot: {
      name: dot.name,
      purpose: dot.purpose,
      instructions: dot.instructions,
      look: dot.look as Record<string, unknown>,
    },
    skills,
    routines,
    rules,
    mcp: [],
    modelHint: dot.model || undefined,
  };

  const validated = packSchema.parse(packData);
  return JSON.stringify(validated, null, 2);
}

export function previewPack(raw: string): {
  ok: boolean;
  pack?: DotPack;
  warnings?: string[];
  sha256?: string;
  error?: string;
} {
  const parsed = parsePack(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const warnings = reviewPack(parsed.pack);
  const sha256 = crypto.createHash("sha256").update(raw).digest("hex");
  return { ok: true, pack: parsed.pack, warnings, sha256 };
}

export function importPack(
  raw: string,
  opts?: { nameOverride?: string }
): { ok: boolean; dotId?: string; error?: string } {
  const parsed = parsePack(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const pack = parsed.pack;

  // Resolve unique name if collision occurs
  const baseName = opts?.nameOverride || pack.dot.name;
  let targetName = baseName;
  let counter = 1;
  while (repo.findDotByName(targetName)) {
    targetName = `${baseName} ${++counter}`;
  }

  const dot = repo.createDot({
    name: targetName,
    purpose: pack.dot.purpose,
    instructions: pack.dot.instructions,
    look: normalizeLook(pack.dot.look),
  });

  for (const s of pack.skills) {
    repo.upsertSkill(dot.id, s.name, s.description, s.body);
  }

  for (const r of pack.routines) {
    const routine = repo.addRoutine({
      dotId: dot.id,
      name: r.name,
      instruction: r.instruction,
      schedule: r.schedule,
    });
    // Imported routines are imported turned OFF
    repo.updateRoutine(routine.id, { enabled: false });
  }

  for (const rule of pack.rules) {
    repo.addRule({
      dotId: dot.id,
      action: rule.action,
      decision: rule.decision as RuleDecision,
    });
  }

  return { ok: true, dotId: dot.id };
}
