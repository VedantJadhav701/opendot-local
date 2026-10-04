import "server-only";
import { activeReviewModel, getProvider } from "../llm";
import * as repo from "../repo";
import type { Rule, RuleDecision } from "@/lib/types";

export type Verdict = { decision: RuleDecision; rule: Rule | null };

export async function review(dotId: string, action: string, fallback: RuleDecision): Promise<Verdict> {
  const rules = repo.rulesFor(dotId);
  if (!rules.length) return { decision: fallback, rule: null };

  const list = rules
    .map(
      (r, i) =>
        `${i + 1}. When the dot wants to ${r.action} → ${
          r.decision === "allow" ? "allow automatically" : r.decision === "ask" ? "ask first" : "never allow"
        }`
    )
    .join("\n");

  try {
    const provider = getProvider();
    const reviewModel = await activeReviewModel();

    const response = await provider.chat({
      model: reviewModel,
      messages: [
        {
          role: "system",
          content:
            "You gate actions of a personal AI agent. Decide which of the user's rules (if any) apply to the pending action. " +
            "A rule applies only if the action clearly falls under it. Respond ONLY with a JSON object in format: {\"applying_rules\": [1, 2]} or {\"applying_rules\": []}.",
        },
        {
          role: "user",
          content: `Rules:\n${list}\n\nPending action: the dot wants to ${action}`,
        },
      ],
      temperature: 0.1,
    });

    const content = response.message.content;
    const jsonMatch = content.match(/\{[\s\S]*"applying_rules"[\s\S]*\}/);
    const rawJson = jsonMatch ? jsonMatch[0] : content;
    const parsed = JSON.parse(rawJson) as { applying_rules?: number[] };
    const applyingRules = Array.isArray(parsed.applying_rules) ? parsed.applying_rules : [];

    const matched = applyingRules.map((n) => rules[n - 1]).filter(Boolean);
    if (!matched.length) return { decision: fallback, rule: null };

    const pick = (d: RuleDecision) => matched.find((r) => r.decision === d);
    const rule = pick("never") ?? pick("ask") ?? pick("allow")!;
    return { decision: rule.decision, rule };
  } catch (err) {
    console.warn("[dots] reviewer model failed, falling back to default:", err);
    return { decision: fallback === "allow" ? "allow" : "ask", rule: null };
  }
}
