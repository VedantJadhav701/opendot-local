"use server";

import { exportPack, previewPack, importPack } from "@/server/packs";
import type { DotPack } from "@/lib/pack-schema";

export async function exportDotPack(
  dotId: string
): Promise<{ ok: boolean; json?: string; error?: string }> {
  try {
    const json = exportPack(dotId);
    return { ok: true, json };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function previewDotPack(
  raw: string
): Promise<{
  ok: boolean;
  pack?: DotPack;
  warnings?: string[];
  sha256?: string;
  error?: string;
}> {
  try {
    return previewPack(raw);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function importDotPack(
  raw: string
): Promise<{ ok: boolean; dotId?: string; error?: string }> {
  try {
    return importPack(raw);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
