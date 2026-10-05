import "server-only";

export type TaskIntent = "product_research" | "document_research" | "action_task" | "general_chat";

export type ResearchPlan = {
  intent: TaskIntent;
  constraints: Record<string, string | number>;
  steps: string[];
};

export function parseIntentAndPlan(userText: string): ResearchPlan {
  const text = userText.toLowerCase();

  if (/\b(find|search|best|buy|compare|price|under|top|cheap)\b.*\b(headphone|phone|laptop|earbuds|watch|mouse|keyboard|camera|tv)\b/.test(text)) {
    const budgetMatch = text.match(/(?:under|below|less than|budget of|\u20B9|rs\.?|inr)\s*(\d+)/i);
    const budget = budgetMatch ? parseInt(budgetMatch[1], 10) : 2000;
    return {
      intent: "product_research",
      constraints: {
        category: text.includes("headphone") ? "headphones" : "products",
        maxBudgetINR: budget,
      },
      steps: [
        "Search top candidates via web_search and product_search",
        "Collect candidate names, prices, ratings, and features",
        "Filter out options exceeding budget constraint",
        "Compare specs, battery, mic, and reviews",
        "Rank top 3 best value recommendations with links",
      ],
    };
  }

  if (/\b(pdf|document|file|paper|report|summary|extract|csv|excel|table)\b/.test(text)) {
    return {
      intent: "document_research",
      constraints: { type: "local_file" },
      steps: [
        "Locate target document in workspace or chunk_store",
        "Use search_documents / read_document to extract text sections",
        "Analyze evidence chunks and answer target query",
      ],
    };
  }

  if (/\b(buy|purchase|checkout|delete|remove|send email|post|deploy)\b/.test(text)) {
    return {
      intent: "action_task",
      constraints: { requiresApproval: "true" },
      steps: [
        "Gather target action parameters",
        "Prepare action details",
        "Request explicit user approval before execution",
      ],
    };
  }

  return {
    intent: "general_chat",
    constraints: {},
    steps: ["Provide direct, concise answer"],
  };
}
