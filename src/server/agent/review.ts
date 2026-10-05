import "server-only";
import { activeReviewModel, getProvider } from "../llm";
import * as repo from "../repo";
import type { Rule, RuleDecision } from "@/lib/types";

export type Verdict = { decision: RuleDecision; rule: Rule | null };

// In-memory per-dot taint status for current turn
const turnTaintMap = new Map<string, boolean>();

export function setTurnTainted(dotId: string, tainted = true): void {
  turnTaintMap.set(dotId, tainted);
}

export function isTurnTainted(dotId: string): boolean {
  return turnTaintMap.get(dotId) ?? false;
}

export function resetTurnTaint(dotId: string): void {
  turnTaintMap.delete(dotId);
}

export function checkHardDeny(actionOrCommand: string): string | null {
  const str = actionOrCommand;

  // 1. Recursive delete (including .exe aliases like rm.exe, del.exe)
  if (
    /\b(rm|rm\.exe)\s+-[a-zA-Z]*r[a-zA-Z]*f?\b/i.test(str) ||
    /\b(rm|rm\.exe)\s+-[a-zA-Z]*f[a-zA-Z]*r\b/i.test(str) ||
    /\bRemove-Item\b.*-Recurse/i.test(str) ||
    /\b(rd|rmdir|rmdir\.exe)\s+\/s\b/i.test(str) ||
    /\b(del|del\.exe)\s+(\/f\s+)?\/s\b/i.test(str)
  ) {
    return "Hard deny: Recursive delete commands are strictly forbidden.";
  }

  // 2. Disk format / diskpart
  if (
    /\bformat\s+[a-zA-Z]:/i.test(str) ||
    /\bdiskpart(\.exe)?\b/i.test(str) ||
    /\bmkfs(\.[a-z0-9]+)?\b/i.test(str) ||
    /\bfdisk\b/i.test(str) ||
    /\bparted\b/i.test(str)
  ) {
    return "Hard deny: Disk formatting and partitioning commands are strictly forbidden.";
  }

  // 3. Registry edits
  if (
    /\b(reg|reg\.exe)\s+(add|delete|import)\b/i.test(str) ||
    /\b(regedit|regedit\.exe)\b/i.test(str) ||
    /\b(Set-ItemProperty|Remove-ItemProperty)\b.*HK/i.test(str)
  ) {
    return "Hard deny: Windows Registry modifications are strictly forbidden.";
  }

  // 4. Credential stores / sensitive files
  if (
    /\b(cmdkey|cmdkey\.exe)\b/i.test(str) ||
    /\b(VaultCmd|VaultCmd\.exe)\b/i.test(str) ||
    /\bsecurity\s+find-(generic|internet)-password\b/i.test(str) ||
    /\/etc\/(shadow|passwd|sudoers)/i.test(str) ||
    /\.aws\/credentials/i.test(str)
  ) {
    return "Hard deny: Access to credential stores and system auth files is strictly forbidden.";
  }

  // 5. Pipe-to-shell
  if (
    /(curl|wget|iwr|Invoke-WebRequest|Invoke-RestMethod)\b.*\|\s*(bash|sh|zsh|powershell|pwsh|iex|Invoke-Expression)\b/i.test(str)
  ) {
    return "Hard deny: Piping remote content directly into shell/eval is strictly forbidden.";
  }

  // 6. Writing outside workspace (including UNC paths \\server\share and NTFS Alternate Data Streams :stream)
  if (
    />>?\s*([a-zA-Z]:[\\\/]|\/|~|%USERPROFILE%|\.\.|\\\\|\/\/)/i.test(str) ||
    /\btee\s+(-a\s+)?([a-zA-Z]:[\\\/]|\/|~|\.\.|\\\\|\/\/)/i.test(str) ||
    />>?\s*[^\s]+:[a-zA-Z0-9_$]+/i.test(str)
  ) {
    return "Hard deny: Writing outside workspace, UNC paths, or Alternate Data Streams is strictly forbidden.";
  }

  return null;
}

export async function review(
  dotId: string,
  action: string,
  fallback: RuleDecision,
  toolName?: string
): Promise<Verdict> {
  // 1. Check code-level hard deny list first (overrides ALL rules and LLM verdicts)
  const hardDenyReason = checkHardDeny(action);
  if (hardDenyReason) {
    return {
      decision: "never",
      rule: {
        id: "hard_deny",
        dotId,
        action: hardDenyReason,
        decision: "never",
        createdAt: Date.now(),
      },
    };
  }

  // 2. Check untrusted-content taint for shell and write actions
  const isShellOrWrite =
    toolName === "run_command" ||
    toolName === "run_on_my_computer" ||
    toolName === "write_file" ||
    action.includes("run `") ||
    action.includes("write to");

  let effectiveFallback = fallback;
  if (isTurnTainted(dotId) && isShellOrWrite) {
    if (effectiveFallback === "allow") {
      effectiveFallback = "ask";
    }
  }

  const rules = repo.rulesFor(dotId);
  if (!rules.length) return { decision: effectiveFallback, rule: null };

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
    if (!matched.length) return { decision: effectiveFallback, rule: null };

    const pick = (d: RuleDecision) => matched.find((r) => r.decision === d);
    const rule = pick("never") ?? pick("ask") ?? pick("allow")!;

    let finalDecision = rule.decision;
    if (isTurnTainted(dotId) && isShellOrWrite && finalDecision === "allow") {
      finalDecision = "ask";
    }

    return { decision: finalDecision, rule };
  } catch (err) {
    console.warn("[dots] reviewer model failed, falling back to default:", err);
    return { decision: effectiveFallback === "allow" ? "allow" : "ask", rule: null };
  }
}

