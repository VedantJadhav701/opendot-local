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

  // 2. Remove closing offers strictly at end of message (last paragraph / last ~200 chars)
  const offerRegex = /(?:let me know|feel free|hope this helps|how else can i|if you have any|if you'd like|is there anything else|reach out if)/i;

  const paragraphs = clean.split(/\n\s*\n/);
  if (paragraphs.length > 0) {
    const lastParagraph = paragraphs[paragraphs.length - 1];
    const match = lastParagraph.match(/^(?:\s*)(?:let me know|feel free|hope this helps|how else can i|if you have any|if you'd like|is there anything else|reach out if)[\s\S]*$/i);
    if (match && lastParagraph.length <= 250) {
      paragraphs.pop();
      clean = paragraphs.join("\n\n").trim();
    } else {
      const inlineMatch = lastParagraph.match(/(?:\s*)(?:let me know|feel free|hope this helps|how else can i|if you have any|if you'd like|is there anything else|reach out if)[\s\S]*$/i);
      if (inlineMatch && (lastParagraph.length - (inlineMatch.index || 0)) <= 200) {
        paragraphs[paragraphs.length - 1] = lastParagraph.slice(0, inlineMatch.index).trim();
        clean = paragraphs.join("\n\n").trim();
      }
    }
  }

  return clean;
}
