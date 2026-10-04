import "server-only";
import * as repo from "./repo";

export const VOICE_MODEL = process.env.DOTS_VOICE_MODEL || "gpt-realtime-2.1";

export async function createVoiceSession(_dotId: string, _convId: string): Promise<{ token: string; model: string }> {
  throw new Error("Voice mode requires cloud realtime model endpoint. Open Dot Local is optimized for local-first text & computer automation.");
}
