"use server";

import { addFolder, removeFolder, scanFolder, listFolders } from "@/server/context/folder-index";
import type { FolderInfo } from "@/lib/types";

export async function addFolderAction(dotId: string, folderPath: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const res = addFolder(dotId, folderPath);
    // Trigger initial scan in background
    void scanFolder(res.id).catch((err) => console.warn(`[dots] Initial scan failed for ${res.id}:`, err));
    return { ok: true, id: res.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function removeFolderAction(folderId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    removeFolder(folderId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function rescanFolderAction(folderId: string): Promise<{ ok: boolean; files?: number; chunks?: number; error?: string }> {
  try {
    const res = await scanFolder(folderId);
    return { ok: true, files: res.files, chunks: res.chunks };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function listFoldersAction(dotId: string): Promise<FolderInfo[]> {
  try {
    const rows = listFolders(dotId);
    return rows.map((r) => ({
      id: r.id,
      dotId: r.dot_id,
      path: r.path,
      addedAt: r.added_at,
      lastScanAt: r.last_scan_at,
      files: r.files,
      chunks: r.chunks,
      status: r.status,
    }));
  } catch {
    return [];
  }
}
