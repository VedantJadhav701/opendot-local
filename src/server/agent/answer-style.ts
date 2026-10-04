/**
 * Cleans assistant response text to ensure strict answer style:
 * - No emoji
 * - No closing offers (e.g. "Let me know if...", "Feel free to...")
 */
export function sanitizeAnswerStyle(text: string): string {
  if (!text) return text;

  // 1. Remove emoji characters
  let clean = text.replace(
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}]/gu,
    ""
  );

  // 2. Remove closing offers at end of message
  clean = clean.replace(
    /(?:\n\n|\n|^)\s*(?:let me know|feel free|hope this helps|how else can i|if you have any|if you'd like|is there anything else|reach out if)[\s\S]*$/gi,
    ""
  ).trim();

  return clean;
}
