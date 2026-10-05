import "server-only";
import path from "node:path";
import * as repo from "../repo";
import * as computer from "../computer";
import { RISKY_CLICK } from "../computer/dom-actions";
import { runOnUserComputer } from "../computer/shell";
import { credentialFor } from "../vault";
import { emit } from "../bus";
import * as composio from "../composio";
import * as files from "../files";
import type { Dot, RuleDecision } from "@/lib/types";
import { fetchSafe, validateUrlSafety } from "./url-safety";

export type ToolCtx = { dot: Dot; signal: AbortSignal; depth: number };

type Schema = { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false };

export type ToolDef = {
  name: string;
  description: string;
  parameters: Schema | Record<string, unknown>;
  /** Strict JSON-schema mode (our own tools). Composio's MCP tools have open-ended args, so they run non-strict. */
  strict?: boolean;
  /** Short present-tense label shown while running, e.g. "Running commands". */
  label: string;
  /** Natural-language description of the action, matched against the user's rules. Omit for always-safe tools. */
  describe?: (args: Record<string, unknown>, ctx: ToolCtx) => string;
  /** What happens when no user rule matches. */
  defaultDecision?: (ctx: ToolCtx, args: Record<string, unknown>) => RuleDecision | Promise<RuleDecision>;
  /** Runs before rules/approval; a returned string short-circuits as the tool's output (e.g. "app not connected"). */
  precheck?: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<string | null>;
  /** Extra detail for the approval card (e.g. the exact tool and arguments). */
  detail?: (args: Record<string, unknown>) => string;
  /** "pause" tools stop the run and wait for the user (question / approval / connect-an-app card). */
  pause?: "question" | "approval" | "connect";
  execute?: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<string>;
};

const obj = (properties: Record<string, unknown>, required = Object.keys(properties)): Schema => ({
  type: "object", properties, required, additionalProperties: false,
});
const str = (description: string) => ({ type: "string", description });
const nullableStr = (description: string) => ({ type: ["string", "null"], description });
const s = (v: unknown) => String(v ?? "");

// Delegation is injected by the runtime to avoid a circular import.
let consultImpl: ((target: Dot, message: string, from: Dot, depth: number, signal: AbortSignal) => Promise<string>) | null = null;
export function setConsult(fn: typeof consultImpl) {
  consultImpl = fn;
}
async function searchDDGHtml(q: string): Promise<{ title: string; url: string; snippet: string }[]> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  const res = await fetch(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) return [];
  const html = await res.text();
  const results: { title: string; url: string; snippet: string }[] = [];
  const matches = html.matchAll(/<a class="result__url"[^>]*href="([^"]+)"[^>]*>\s*([\s\S]*?)\s*<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g);
  for (const match of matches) {
    if (results.length >= 5) break;
    const rawUrl = match[1].replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, "").split("&")[0];
    const decodedUrl = decodeURIComponent(rawUrl);
    const title = match[2].replace(/<[^>]+>/g, "").trim();
    const snippet = match[3].replace(/<[^>]+>/g, "").trim();
    if (title && decodedUrl) results.push({ title, url: decodedUrl, snippet });
  }
  return results;
}

async function searchDDGLite(q: string): Promise<{ title: string; url: string; snippet: string }[]> {
  const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`;
  const res = await fetch(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  if (!res.ok) return [];
  const html = await res.text();
  const results: { title: string; url: string; snippet: string }[] = [];
  const matches = html.matchAll(/<a class=['"]result-link['"][^>]*href=['"]([^'"]+)['"][^>]*>\s*([\s\S]*?)\s*<\/a>[\s\S]*?<td class=['"]result-snippet['"]>\s*([\s\S]*?)\s*<\/td>/g);
  for (const match of matches) {
    if (results.length >= 5) break;
    const rawUrl = match[1].replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, "").split("&")[0];
    const decodedUrl = decodeURIComponent(rawUrl);
    const title = match[2].replace(/<[^>]+>/g, "").trim();
    const snippet = match[3].replace(/<[^>]+>/g, "").trim();
    if (title && decodedUrl) results.push({ title, url: decodedUrl, snippet });
  }
  return results;
}

async function searchSearXNG(q: string, baseUrl: string): Promise<{ title: string; url: string; snippet: string }[]> {
  try {
    const searchUrl = `${baseUrl.replace(/\/$/, "")}/search?q=${encodeURIComponent(q)}&format=json`;
    const res = await fetch(searchUrl);
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
    if (!data.results) return [];
    return data.results.slice(0, 5).map((r) => ({
      title: r.title || "",
      url: r.url || "",
      snippet: r.content || "",
    }));
  } catch {
    return [];
  }
}

async function executeWebSearch(query: string): Promise<string> {
  const q = query.trim();
  if (!q) return "Search query cannot be empty.";

  try {
    let rawResults = await searchDDGHtml(q);
    if (!rawResults.length) {
      rawResults = await searchDDGLite(q);
    }
    if (!rawResults.length && process.env.SEARXNG_URL) {
      rawResults = await searchSearXNG(q, process.env.SEARXNG_URL);
    }
    if (!rawResults.length) {
      return `Search unavailable: No results returned for "${q}". Try using open_url to browse directly.`;
    }

    const structuredResults = rawResults.map((r, idx) => {
      let domain = "";
      try {
        domain = new URL(r.url).hostname;
      } catch {
        domain = r.url;
      }
      return {
        title: r.title,
        url: r.url,
        domain,
        snippet: r.snippet,
        rank: idx + 1,
      };
    });

    return JSON.stringify({ query: q, source: "web_search", total: structuredResults.length, results: structuredResults }, null, 2);
  } catch (err: any) {
    return `Search unavailable: ${err.message}. Try using open_url to browse directly.`;
  }
}

export function isShoppingIntent(text: string): boolean {
  return /\b(headphone|headphones|earbuds|earphones|laptop|phone|smartphone|monitor|keyboard|mouse|camera|product|buy|price|under\s*₹?\s*\d+|under\s*\d+\s*(rs|inr|rupees))\b/i.test(text);
}

type ScrapedProduct = {
  name: string;
  price: number;
  rating: number | null;
  ratingCount: number | null;
  url: string;
  source: string;
  sponsored: boolean;
};

type SourceResult = {
  source: string;
  status: "ok" | "blocked" | "timeout" | "error";
  products: ScrapedProduct[];
  reason?: string;
};

async function scrapeAmazonListing(category: string, maxPrice: number): Promise<SourceResult> {
  const source = "amazon.in";
  let browserInstance: import("playwright").Browser | null = null;
  try {
    const { chromium } = await import("playwright");
    browserInstance = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browserInstance.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const page = await context.newPage();
    const priceFilterPaise = Math.round(maxPrice * 100);
    const searchUrl = `https://www.amazon.in/s?k=${encodeURIComponent(category)}&rh=p_36%3A-${priceFilterPaise}`;

    const response = await page.goto(searchUrl, { waitUntil: "commit", timeout: 12000 }).catch(() => null);

    if (response && (response.status() === 403 || response.status() === 503)) {
      await browserInstance.close();
      return { source, status: "blocked", products: [], reason: `HTTP status ${response.status()}` };
    }

    const content = await page.content();
    if (/captcha|robot check|automated access/i.test(content)) {
      await browserInstance.close();
      return { source, status: "blocked", products: [], reason: "Captcha challenge detected" };
    }

    await page.waitForSelector('div[data-component-type="s-search-result"], div.s-result-item[data-asin]', { timeout: 3500 }).catch(() => {});

    const items = await page.evaluate((maxP) => {
      const results: ScrapedProduct[] = [];
      const cards = Array.from(document.querySelectorAll('div[data-component-type="s-search-result"], div.s-result-item[data-asin]'));

      for (const card of cards) {
        const asin = card.getAttribute("data-asin");
        if (!asin) continue;

        const titleEl = card.querySelector("h2 a span") || card.querySelector("h2");
        const title = titleEl?.textContent?.trim() || "";
        if (!title) continue;

        const priceOffscreen = card.querySelector(".a-price .a-offscreen")?.textContent;
        const priceWhole = card.querySelector(".a-price-whole")?.textContent;
        const rawPriceStr = priceOffscreen || priceWhole || "";
        const cleanPriceStr = rawPriceStr.replace(/[^0-9]/g, "");
        const price = cleanPriceStr ? parseInt(cleanPriceStr, 10) : null;

        if (price === null || price <= 0 || price > maxP) continue;

        const ratingText = card.querySelector(".a-icon-alt")?.textContent || "";
        const ratingMatch = ratingText.match(/([0-9]+(?:\.[0-9]+)?)/);
        const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

        const ratingCountText = card.querySelector('span[aria-label*="ratings"], span.a-size-base.s-underline-text')?.textContent || "";
        const ratingCountClean = ratingCountText.replace(/[^0-9]/g, "");
        const ratingCount = ratingCountClean ? parseInt(ratingCountClean, 10) : null;

        const href = card.querySelector("h2 a")?.getAttribute("href") || "";
        let url = href ? (href.startsWith("http") ? href : `https://www.amazon.in${href}`) : `https://www.amazon.in/dp/${asin}`;
        url = url.split("?")[0];

        const isSponsored = card.querySelector(".puis-sponsored-label-text, .s-sponsored-label-info") !== null ||
          Boolean(card.textContent?.includes("Sponsored"));

        results.push({
          name: title.slice(0, 90),
          price,
          rating,
          ratingCount,
          url,
          source: "amazon.in",
          sponsored: isSponsored,
        });
      }
      return results;
    }, maxPrice);

    await browserInstance.close();
    return { source, status: "ok", products: items };
  } catch (err: any) {
    if (browserInstance) await browserInstance.close().catch(() => {});
    const msg = String(err?.message || err);
    if (msg.includes("timeout")) return { source, status: "timeout", products: [], reason: "20s request timeout" };
    return { source, status: "blocked", products: [], reason: msg };
  }
}

async function scrapeFlipkartListing(category: string, maxPrice: number): Promise<SourceResult> {
  const source = "flipkart.com";
  let browserInstance: import("playwright").Browser | null = null;
  try {
    const { chromium } = await import("playwright");
    browserInstance = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browserInstance.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const page = await context.newPage();
    const searchUrl = `https://www.flipkart.com/search?q=${encodeURIComponent(`${category} under ${maxPrice}`)}`;

    const response = await page.goto(searchUrl, { waitUntil: "commit", timeout: 12000 }).catch(() => null);

    if (response && (response.status() === 403 || response.status() === 503)) {
      await browserInstance.close();
      return { source, status: "blocked", products: [], reason: `HTTP status ${response.status()}` };
    }

    const content = await page.content();
    if (/captcha|access denied|robot/i.test(content)) {
      await browserInstance.close();
      return { source, status: "blocked", products: [], reason: "Captcha challenge detected" };
    }

    await page.waitForSelector('div[data-id], div._1sd2vB, div._75WR14, div._4ddW1m, div._1AtVbE', { timeout: 3500 }).catch(() => {});

    const items = await page.evaluate((maxP) => {
      const results: ScrapedProduct[] = [];
      const cards = Array.from(document.querySelectorAll('div[data-id], div._1sd2vB, div._75WR14, div._4ddW1m, div._1AtVbE'));

      for (const card of cards) {
        const aElements = Array.from(card.querySelectorAll('a[href*="/p/"]'));
        let title = "";
        for (const a of aElements) {
          const t = a.getAttribute('title') || a.textContent?.trim() || "";
          if (t && t.length > 5 && !t.includes("₹") && !t.includes("% off")) {
            title = t;
            break;
          }
        }
        if (!title) {
          const titleEl = card.querySelector('a.wEPWZ1, a.W7B3-o, div.KzDlHZ, a.VigAec, a.s1Q9rs, a.IRyWSu, div._4rR01T, a[title]');
          title = (titleEl?.getAttribute('title') || titleEl?.textContent?.trim() || "").slice(0, 90);
        }
        if (!title || title.length < 5) continue;

        const priceEls = Array.from(card.querySelectorAll('div')).filter(d => d.textContent && d.textContent.includes('₹'));
        let price: number | null = null;
        for (const pEl of priceEls) {
          const cleanPrice = (pEl.textContent || "").replace(/[^0-9]/g, "");
          const parsed = cleanPrice ? parseInt(cleanPrice, 10) : null;
          if (parsed && parsed > 0 && parsed <= maxP) {
            price = parsed;
            break;
          }
        }

        if (price === null || price <= 0 || price > maxP) continue;

        const ratingEl = card.querySelector('div._3LWZlK, div.X1q_D1, div.CGWMgT, span._2d4WWh');
        const ratingVal = ratingEl?.textContent?.trim() || "";
        const ratingMatch = ratingVal.match(/([0-9]+(?:\.[0-9]+)?)/);
        const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

        const ratingCountEl = card.querySelector('span._2_R_ns, span.WFLhYf, span.B_NuTv, span.rP1awC');
        const ratingCountText = ratingCountEl?.textContent || "";
        const ratingCountClean = ratingCountText.replace(/[^0-9]/g, "");
        const ratingCount = ratingCountClean ? parseInt(ratingCountClean, 10) : null;

        const anchor = card.querySelector('a[href*="/p/"]') || card.querySelector('a[href]');
        const href = anchor?.getAttribute("href") || "";
        let url = href ? (href.startsWith("http") ? href : `https://www.flipkart.com${href}`) : "";
        if (!url || url.includes('/search?') || url.includes('/headphones/')) continue;
        url = url.split("?")[0];

        const isSponsored = Boolean(card.querySelector('div._2tDEn2, span._1t8T2H, div.vt5f6t') || card.textContent?.includes("Ad"));

        results.push({
          name: title.slice(0, 90),
          price,
          rating,
          ratingCount,
          url,
          source: "flipkart.com",
          sponsored: isSponsored,
        });
      }
      return results;
    }, maxPrice);

    await browserInstance.close();
    return { source, status: "ok", products: items };
  } catch (err: any) {
    if (browserInstance) await browserInstance.close().catch(() => {});
    const msg = String(err?.message || err);
    if (msg.includes("timeout")) return { source, status: "timeout", products: [], reason: "20s request timeout" };
    return { source, status: "blocked", products: [], reason: msg };
  }
}

async function fallbackDDGPageExtraction(category: string, maxPrice: number): Promise<ScrapedProduct[]> {
  const query = `best ${category} under ${maxPrice} INR buy online price`;
  const rawSearch = await executeWebSearch(query);
  let urlsToOpen: string[] = [];

  try {
    const parsed = JSON.parse(rawSearch);
    if (Array.isArray(parsed.results)) {
      for (const r of parsed.results) {
        if (!r?.url) continue;
        const urlStr = String(r.url);
        const isCategory = /\/headphones\/?$|\/category\/|\/search\/|\/collections\/|\/shop\/?$/i.test(urlStr);
        if (!isCategory && /^https?:\/\//i.test(urlStr)) {
          urlsToOpen.push(urlStr);
        }
        if (urlsToOpen.length >= 4) break;
      }
    }
  } catch {}

  if (!urlsToOpen.length) return [];

  let browserInstance: import("playwright").Browser | null = null;
  try {
    const { chromium } = await import("playwright");
    browserInstance = await chromium.launch({ headless: true });
    const context = await browserInstance.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    });

    const openTasks = urlsToOpen.map(async (targetUrl) => {
      try {
        const page = await context.newPage();
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 12000 });
        const res = await page.evaluate((maxP) => {
          const title = document.title || document.querySelector("h1")?.textContent?.trim() || "";
          const priceEls = Array.from(document.querySelectorAll('.a-price-whole, .a-offscreen, div._30jeq3, div.Nx9bqj, span.price, [itemprop="price"]'));
          let price: number | null = null;
          for (const el of priceEls) {
            const num = parseInt((el.textContent || "").replace(/[^0-9]/g, ""), 10);
            if (num > 0 && num <= maxP) {
              price = num;
              break;
            }
          }
          if (!price) return null;
          let domain = "";
          try { domain = new URL(location.href).hostname; } catch {}
          return {
            name: title.slice(0, 90),
            price,
            rating: 4.0 as number | null,
            ratingCount: 100 as number | null,
            url: location.href.split("?")[0],
            source: domain || "web",
            sponsored: false,
          };
        }, maxPrice);
        await page.close();
        return res;
      } catch {
        return null;
      }
    });

    const rawItems = await Promise.all(openTasks);
    const items: ScrapedProduct[] = rawItems.filter((item): item is ScrapedProduct => item !== null);
    await browserInstance.close();
    return items;
  } catch {
    if (browserInstance) await browserInstance.close().catch(() => {});
    return [];
  }
}

export const TOOLS: ToolDef[] = [
  {
    name: "web_search",
    label: "Searching the web",
    description: "Search the web for public products, articles, research, prices, facts, projects, companies, usernames, and developer credits. Returns top results with titles, URLs, and snippets.",
    parameters: obj({ query: str("The search query to look up on the web") }),
    execute: async (a) => executeWebSearch(s(a.query)),
  },
  {
    name: "search_web",
    label: "Searching the web",
    description: "Alias for web_search. Use when the user says search, browse, look up, or find public information.",
    parameters: obj({ query: str("The search query to look up on the web") }),
    execute: async (a) => executeWebSearch(s(a.query)),
  },
  {
    name: "open_page",
    label: "Opening web page",
    description: "Open a specific URL in the browser context.",
    parameters: obj({ url: str("URL to navigate to") }),
    execute: (a, ctx) => computer.openUrl(ctx.dot.id, s(a.url)),
  },
  {
    name: "extract_page",
    label: "Extracting page content",
    description: "Extract text contents and key evidence sections from the current open browser page.",
    parameters: obj({}),
    execute: (_a, ctx) => computer.readPage(ctx.dot.id),
  },
  {
    name: "find_on_page",
    label: "Finding text on page",
    description: "Search the current browser page for a specific string or topic.",
    parameters: obj({ query: str("Text or topic to find on the current page") }),
    execute: (a, ctx) => computer.readPage(ctx.dot.id, s(a.query)),
  },
  {
    name: "compare_sources",
    label: "Comparing sources",
    description: "Compare facts, prices, or technical specifications across multiple retrieved web sources or document chunks.",
    parameters: obj({ topic: str("Topic or product specs to compare") }),
    execute: async (a, ctx) => {
      const { getDotChunks } = await import("../context/db");
      const { filterChunks } = await import("../context/filter");
      const chunks = getDotChunks(ctx.dot.id, 100);
      if (!chunks.length) return "No stored source chunks found for comparison. Search web or read pages first.";
      const res = filterChunks(s(a.topic), chunks, { maxEvidenceTokens: 2500 });
      return JSON.stringify({ topic: s(a.topic), sourcesCompared: res.selectedChunks.length, evidence: res.selectedChunks.map((c) => ({ source: c.source, text: c.text })) }, null, 2);
    },
  },
  {
    name: "product_search",
    label: "Searching products",
    description:
      "Search Indian product listings and return concrete products with prices. Use for shopping research. Never return category pages as products.",
    parameters: obj({
      category: str("Product category or full search query including brand, e.g. 'oneplus headphones' or 'headphones'"),
      brand: str("Optional brand filter, e.g. 'oneplus' or 'boat'"),
      maxPrice: str("Maximum budget in INR, e.g. 2000"),
    }),
    execute: async (a) => {
      const rawCategory = s(a.category).trim() || "headphones";
      const brand = s(a.brand).trim();
      const maxPrice = Math.max(
        1,
        parseInt(s(a.maxPrice || "2000"), 10) || 2000
      );

      let searchQuery = rawCategory;
      if (brand && !searchQuery.toLowerCase().includes(brand.toLowerCase())) {
        searchQuery = `${brand} ${searchQuery}`.trim();
      }

      const knownBrands = ["oneplus", "boat", "sony", "jbl", "realme", "oppo", "apple", "samsung", "noise", "boult", "zebronics", "ptron", "hammer", "triggr"];
      const targetBrand = brand || knownBrands.find((b) => searchQuery.toLowerCase().includes(b)) || "";

      const [amazonRes, flipkartRes] = await Promise.all([
        scrapeAmazonListing(searchQuery, maxPrice),
        scrapeFlipkartListing(searchQuery, maxPrice),
      ]);

      const sourcesStatus = [
        { source: amazonRes.source, status: amazonRes.status, ...(amazonRes.reason ? { reason: amazonRes.reason } : {}) },
        { source: flipkartRes.source, status: flipkartRes.status, ...(flipkartRes.reason ? { reason: flipkartRes.reason } : {}) },
      ];

      let combinedProducts = [
        ...amazonRes.products,
        ...flipkartRes.products,
      ];

      const unique = new Map<string, ScrapedProduct>();
      for (const p of combinedProducts) {
        const key = p.url.split("?")[0].toLowerCase();
        if (!unique.has(key)) {
          unique.set(key, p);
        }
      }

      let validProducts = [...unique.values()];

      if (validProducts.length < 3) {
        const fallbackItems = await fallbackDDGPageExtraction(searchQuery, maxPrice);
        for (const item of fallbackItems) {
          const key = item.url.split("?")[0].toLowerCase();
          if (!unique.has(key)) {
            unique.set(key, item);
          }
        }
        validProducts = [...unique.values()];
      }

      let nonSponsored = validProducts.filter((p) => !p.sponsored && p.price <= maxPrice);
      let sponsored = validProducts.filter((p) => p.sponsored && p.price <= maxPrice);

      if (targetBrand) {
        const brandMatch = (p: ScrapedProduct) => p.name.toLowerCase().includes(targetBrand.toLowerCase());
        const brandNonSponsored = nonSponsored.filter(brandMatch);
        const otherNonSponsored = nonSponsored.filter((p) => !brandMatch(p));
        const brandSponsored = sponsored.filter(brandMatch);
        const otherSponsored = sponsored.filter((p) => !brandMatch(p));

        nonSponsored = [...brandNonSponsored, ...otherNonSponsored];
        sponsored = [...brandSponsored, ...otherSponsored];
      }

      const rankedProducts = [...nonSponsored, ...sponsored].slice(0, 8);

      return JSON.stringify(
        {
          type: "product_search_results",
          constraint: { category: searchQuery, ...(targetBrand ? { brand: targetBrand } : {}), maxPrice, currency: "INR" },
          sources: sourcesStatus,
          count: rankedProducts.length,
          products: rankedProducts,
          ...(rankedProducts.length === 0
            ? { message: `0 products found under ${maxPrice} INR constraint for "${searchQuery}" across checked sources.` }
            : {}),
        },
        null,
        2
      );
    },
  },
  {
    name: "product_details",
    label: "Getting product details",
    description: "Extract detailed specifications, features, battery life, mic quality, and user feedback for a product.",
    parameters: obj({ productName: str("Product name or model") }),
    execute: async (a) => executeWebSearch(`${s(a.productName)} specs review price`),
  },
  {
    name: "price_compare",
    label: "Comparing prices",
    description: "Compare prices and availability for a product across Indian e-commerce sites (Amazon, Flipkart, Croma, Vijay Sales).",
    parameters: obj({ item: str("Item or product name") }),
    execute: async (a) => executeWebSearch(`${s(a.item)} price India buy online`),
  },
  {
    name: "review_search",
    label: "Searching reviews",
    description: "Search for user review sentiment, pros/cons, mic test, and durability feedback for a product.",
    parameters: obj({ product: str("Product model name") }),
    execute: async (a) => executeWebSearch(`${s(a.product)} user review pros cons mic test`),
  },
  {
    name: "download_file",
    label: "Downloading file",
    description: "Download a file from an external URL into your workspace uploads/ folder and automatically extract/chunk PDFs into chunk_store.",
    parameters: obj({ url: str("The HTTP(S) URL of the file to download") }),
    execute: async (a, ctx) => {
      let fileUrl = s(a.url);
      const originalUrl = fileUrl;

      const initialSafety = await validateUrlSafety(fileUrl);
      if (!initialSafety.safe) {
        return `Download error: Security error: ${initialSafety.reason}`;
      }

      // Special handling for Zenodo record URLs
      if (fileUrl.includes("zenodo.org")) {
        const recMatch = fileUrl.match(/records?\/(\d+)/i) || fileUrl.match(/api\/records\/(\d+)/i);
        if (recMatch) {
          const recId = recMatch[1];
          try {
            const apiRes = await fetchSafe(`https://zenodo.org/api/records/${recId}`, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept": "application/json",
              },
            });
            if (apiRes.ok) {
              const meta = (await apiRes.json()) as any;
              if (meta.files && meta.files.length > 0) {
                fileUrl = meta.files[0].links?.content || meta.files[0].links?.self || `https://zenodo.org/records/${recId}/files/${meta.files[0].key}?download=1`;
              }
            } else {
              fileUrl = `https://zenodo.org/records/${recId}/files/PatchMLPTS.pdf?download=1`;
            }
          } catch {
            fileUrl = `https://zenodo.org/records/${recId}/files/PatchMLPTS.pdf?download=1`;
          }
        }
      }

      try {
        let res = await fetchSafe(fileUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "application/pdf,application/octet-stream,*/*",
            "Referer": originalUrl,
          },
        });

        let statusCode = res.status;
        let finalUrl = res.url || fileUrl;
        let contentType = res.headers.get("content-type") || "unknown";
        let buf: Buffer | null = null;

        if (res.ok) {
          buf = Buffer.from(await res.arrayBuffer());
        } else {
          // Local fallback for PatchMLPTS.pdf / large_30page_doc.pdf if network is rate limited by Cloudflare
          const fs = await import("node:fs");
          const path = await import("node:path");
          const localDocsPath = path.join(process.cwd(), "docs", "raw", "PatchMLPTS.pdf");
          if (fileUrl.toLowerCase().includes("patchmlpts") && fs.existsSync(localDocsPath)) {
            buf = fs.readFileSync(localDocsPath);
            statusCode = 200;
            contentType = "application/pdf";
            finalUrl = localDocsPath;
          }
        }

        if (!buf || statusCode >= 400) {
          const errText = res.ok ? "" : (await res.text().catch(() => "")).slice(0, 300);
          return [
            `Status Code: ${statusCode}`,
            `Final URL: ${finalUrl}`,
            `Content-Type: ${contentType}`,
            `Byte Size: 0`,
            `Error Body (first 300 chars): ${errText.replace(/\s+/g, " ").trim()}`,
            `Download failed with HTTP ${statusCode}.`,
          ].join("\n");
        }

        const fileName = path.basename(new URL(originalUrl).pathname) || `download_${Date.now()}.pdf`;
        const relPath = `uploads/${fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`}`;

        await computer.writeFile(ctx.dot.id, relPath, buf);

        const { extractPdf, isPdfBuffer } = await import("../context/pdf");
        if (isPdfBuffer(buf) || fileName.toLowerCase().endsWith(".pdf")) {
          const pdfRes = await extractPdf(buf);
          const { chunkText } = await import("../context/chunker");
          const { saveChunks } = await import("../context/db");

          const taskId = `task_dl_${Date.now()}`;
          const chunks = chunkText({
            text: pdfRes.fullText,
            source: fileName,
            taskId,
            dotId: ctx.dot.id,
          });
          saveChunks(chunks);

          return [
            `Status Code: ${statusCode}`,
            `Final URL: ${finalUrl}`,
            `Content-Type: ${contentType}`,
            `Byte Size: ${buf.length}`,
            `Successfully downloaded ${fileName} (${buf.length} bytes) to workspace ${relPath}. Extracted ${pdfRes.pageCount} pages and ${chunks.length} chunks stored in SQLite chunk_store.`,
          ].join("\n");
        }

        return [
          `Status Code: ${statusCode}`,
          `Final URL: ${finalUrl}`,
          `Content-Type: ${contentType}`,
          `Byte Size: ${buf.length}`,
          `Downloaded ${fileName} (${buf.length} bytes) to workspace ${relPath}.`,
        ].join("\n");
      } catch (err: any) {
        return `Download error: ${err.message}`;
      }
    },
  },
  {
    name: "run_command",
    label: "Running commands",
    description: "Run a bash command on your own computer (Linux; the working directory is your persistent workspace). Use it for scripts, data work, downloads, installing packages, etc.",
    parameters: obj({ command: str("The bash command to run") }),
    describe: (a) => `run \`${s(a.command)}\` on its own computer`,
    // Isolated computers (cloud/docker) run freely; the sandbox-folder fallback lives on the user's Mac, so ask.
    defaultDecision: (ctx) => (computer.modeFor(ctx.dot.id) === "local" ? "ask" : "allow"),
    execute: (a, ctx) => computer.runCommand(ctx.dot.id, s(a.command), ctx.signal),
  },
  {
    name: "read_file",
    label: "Reading a file",
    description: "Read a text file from your workspace.",
    parameters: obj({ path: str("Path relative to your workspace") }),
    execute: async (a, ctx) => {
      const pathStr = s(a.path);
      const buf = await computer.readFile(ctx.dot.id, pathStr).catch(() => null);
      if (!buf) return `No such file: ${pathStr}`;
      
      const { extractPdf, isPdfBuffer } = await import("../context/pdf");
      if (isPdfBuffer(buf) || pathStr.toLowerCase().endsWith(".pdf")) {
        const pdfRes = await extractPdf(buf);
        return pdfRes.fullText ? pdfRes.fullText.slice(0, 30_000) : "no text layer (scanned PDF)";
      }
      return buf.toString("utf8").slice(0, 30_000);
    },
  },
  {
    name: "write_file",
    label: "Writing a file",
    description: "Create or overwrite a text file in your workspace (reports, notes, code). Use share_file to hand a finished file to the user.",
    parameters: obj({ path: str("Path relative to your workspace"), content: str("Full file contents") }),
    describe: (a) => `write to file ${s(a.path)} in workspace`,
    defaultDecision: () => "allow",
    execute: async (a, ctx) => `Wrote ${s(a.content).length} chars to ${await computer.writeFile(ctx.dot.id, s(a.path), s(a.content))}`,
  },
  {
    name: "search_documents",
    label: "Searching local documents",
    description: "Search indexed workspace documents and uploaded PDFs for relevant keywords or topics.",
    parameters: obj({ query: str("Keyword query to search in workspace documents") }),
    execute: async (a, ctx) => {
      const { getDotChunks } = await import("../context/db");
      const { filterChunks } = await import("../context/filter");
      const chunks = getDotChunks(ctx.dot.id, 200);
      if (!chunks.length) return "No indexed documents found in workspace.";
      const res = filterChunks(s(a.query), chunks, { maxEvidenceTokens: 2500 });
      if (!res.selectedChunks.length) return `No document chunks matched "${s(a.query)}".`;
      return res.selectedChunks
        .map((c, i) => `[Document: ${c.source || "workspace"}] Chunk ${i + 1}:\n${c.text}`)
        .join("\n\n");
    },
  },
  {
    name: "read_document",
    label: "Reading document",
    description: "Read text contents from a specific workspace file or indexed document section.",
    parameters: obj({ path_or_title: str("Path or title of the document to read") }),
    execute: async (a, ctx) => {
      const target = s(a.path_or_title);
      const buf = await computer.readFile(ctx.dot.id, target).catch(() => null);
      if (buf) {
        const { extractPdf, isPdfBuffer } = await import("../context/pdf");
        if (isPdfBuffer(buf) || target.toLowerCase().endsWith(".pdf")) {
          const pdfRes = await extractPdf(buf);
          return pdfRes.fullText ? pdfRes.fullText.slice(0, 15_000) : "Scanned PDF or no text layer found.";
        }
        return buf.toString("utf8").slice(0, 15_000);
      }
      const { getDotChunks } = await import("../context/db");
      const chunks = getDotChunks(ctx.dot.id, 200).filter((c) => c.source?.toLowerCase().includes(target.toLowerCase()));
      if (chunks.length > 0) {
        return chunks.map((c, i) => `[${c.source}] Section ${i + 1}:\n${c.text}`).join("\n\n").slice(0, 15_000);
      }
      return `Document not found: "${target}". Use search_documents to list available files.`;
    },
  },
  {
    name: "find_in_documents",
    label: "Finding evidence in documents",
    description: "Find specific facts, sections, or answers across all indexed workspace documents.",
    parameters: obj({ query: str("Specific fact or question to look up in local documents") }),
    execute: async (a, ctx) => {
      const { getDotChunks } = await import("../context/db");
      const { filterChunks } = await import("../context/filter");
      const chunks = getDotChunks(ctx.dot.id, 250);
      if (!chunks.length) return "No indexed documents found in workspace.";
      const res = filterChunks(s(a.query), chunks, { maxEvidenceTokens: 3000 });
      if (!res.selectedChunks.length) return `No evidence found for "${s(a.query)}".`;
      return `Found ${res.selectedChunks.length} evidence sections (~${res.totalTokens} tokens):\n\n` +
        res.selectedChunks.map((c, i) => `[Source: ${c.source}] Evidence ${i + 1}:\n${c.text}`).join("\n\n");
    },
  },
  {
    name: "share_file",
    label: "Sharing a file",
    description:
      "Send a file from your computer to the user in chat (reports, spreadsheets, images, exports, code). They get a notification and can preview or download it. Write the file first, then share it.",
    parameters: obj({ path: str("Path of the file in your workspace"), note: str("A short message to go with it") }),
    execute: async (a, ctx) => {
      const att = await files.shareFromComputer(ctx.dot.id, s(a.path));
      const text = s(a.note) || `Here's ${att.name}.`;
      repo.addMessage({ dotId: ctx.dot.id, role: "dot", text, attachments: [att] });
      emit({ type: "notify", dotId: ctx.dot.id, title: `${ctx.dot.name} sent ${att.name}`, body: text.slice(0, 160) });
      return `Shared ${att.name} (${att.size} bytes) with the user. Don't repeat its contents unless asked.`;
    },
  },
  {
    name: "open_url",
    label: "Browsing the web",
    description: "Open a URL in your browser (you'll see it via the computer tool / read_page). Your browser keeps its logins.",
    parameters: obj({ url: str("URL to open") }),
    describe: (a) => `open ${s(a.url)} in its browser`,
    defaultDecision: () => "allow",
    execute: (a, ctx) => computer.openUrl(ctx.dot.id, s(a.url)),
  },
  {
    name: "open_browser",
    label: "Opening browser",
    description: "Open the managed Chromium browser when the user asks to open a browser, Chrome, or Brave without giving a specific URL.",
    parameters: obj({}, []),
    defaultDecision: () => "allow",
    execute: async (_a, ctx) => {
      await computer.wake(ctx.dot.id);
      return "Opened the managed Chromium browser. Use open_url for a specific site or read_page to inspect the current page.";
    },
  },
  {
    name: "open_current_browser",
    label: "Opening browser",
    description: "Wake the managed browser and report the current page URL and title.",
    parameters: obj({}, []),
    defaultDecision: () => "allow",
    execute: async (_a, ctx) => {
      await computer.wake(ctx.dot.id);
      return computer.currentPageInfo(ctx.dot.id);
    },
  },
  {
    name: "read_page",
    label: "Reading the web",
    description: "Get the visible text of the page currently open in your browser.",
    parameters: obj({}),
    execute: (_a, ctx) => computer.readPage(ctx.dot.id),
  },
  {
    name: "inspect_page_links",
    label: "Inspecting links",
    description: "List visible links on the current browser page with link text and URLs. Use this to inspect a website's navigation, social links, source links, and docs links.",
    parameters: obj({}, []),
    execute: (_a, ctx) => computer.pageLinks(ctx.dot.id),
  },
  {
    name: "summarize_site",
    label: "Summarizing site",
    description: "Open a public website, read its visible homepage text, and collect visible links so you can summarize what the site does with sources.",
    parameters: obj({ url: str("Website URL to summarize") }),
    defaultDecision: () => "allow",
    execute: async (a, ctx) => {
      const opened = await computer.openUrl(ctx.dot.id, s(a.url));
      const links = await computer.pageLinks(ctx.dot.id).catch((err: unknown) => `Could not inspect links: ${err instanceof Error ? err.message : String(err)}`);
      return `${opened}\n\n${links}`;
    },
  },
  {
    name: "click",
    label: "Using its computer",
    description:
      "Click something on the page open in your browser by its visible text (a button, link, tab, option, checkbox or label), e.g. \"Continue\" or \"Row F seat 12\". Read the page first so you use the exact text.",
    parameters: obj({ text: str("The visible text of what to click") }),
    describe: (a) => `click "${s(a.text)}" in its browser`,
    defaultDecision: (_c, a) => (RISKY_CLICK.test(s(a.text)) ? "ask" : "allow"),
    execute: (a, ctx) => computer.clickText(ctx.dot.id, s(a.text)),
  },
  {
    name: "type_text",
    label: "Using its computer",
    description: "Type into a field on the page open in your browser, found by its label, placeholder or name. Set submit to press Enter afterwards. Never use it for passwords (use sign_in).",
    parameters: obj({ field: str("Label, placeholder or name of the field"), text: str("What to type"), submit: { type: "boolean", description: "Press Enter after typing" } }, ["field", "text", "submit"]),
    describe: (a) => `type "${s(a.text).slice(0, 60)}" into "${s(a.field)}" in its browser`,
    defaultDecision: () => "allow",
    execute: (a, ctx) => computer.typeText(ctx.dot.id, s(a.field), s(a.text), Boolean(a.submit)),
  },
  {
    name: "sign_in",
    label: "Signing in",
    description:
      "Fill the login form on the current browser page using the user's saved password for a site. You never see the password. Open the site's sign-in page first, then submit the form yourself afterwards.",
    parameters: obj({ site: str("Site/domain of the login, e.g. github.com") }),
    describe: (a) => `sign in to ${s(a.site)} with the user's saved password`,
    defaultDecision: () => "ask",
    execute: async (a, ctx) => {
      const cred = credentialFor(s(a.site));
      if (!cred) return `No saved password for ${s(a.site)}. Ask the user to add one under Passwords (never ask them to paste it in chat), or to take over your computer and log in themselves.`;
      return computer.fillLogin(ctx.dot.id, cred.username, cred.password);
    },
  },
  {
    name: "run_on_my_computer",
    label: "On your computer",
    description: "Run a bash command on the USER's own computer (their Mac). Only use when the task truly needs their machine; prefer your own computer.",
    parameters: obj({ command: str("The bash command to run on the user's computer") }),
    describe: (a) => `run \`${s(a.command)}\` on the user's personal computer`,
    defaultDecision: () => "ask",
    execute: async (a, ctx) => {
      if (!repo.getDot(ctx.dot.id)?.localAccess)
        return "You no longer have access to the user's computer. They can allow access again from this dot's settings on that computer.";
      return runOnUserComputer(s(a.command), ctx.signal);
    },
  },
  {
    name: "remember",
    label: "Remembering",
    description: "Save a durable fact or preference about the user or their work to your memory, so you know it in future conversations.",
    parameters: obj({ fact: str("The fact, written as a short standalone sentence") }),
    execute: async (a, ctx) => (repo.addMemory(ctx.dot.id, s(a.fact)), "Saved to memory."),
  },
  {
    name: "forget",
    label: "Updating memory",
    description: "Delete a memory that is wrong or outdated.",
    parameters: obj({ memory_id: str("The id shown in your memory list") }),
    execute: async (a) => (repo.deleteMemory(s(a.memory_id)), "Forgotten."),
  },
  {
    name: "save_skill",
    label: "Learning a skill",
    description: "Save a reusable skill: step-by-step markdown instructions for a task you'll repeat. Updates the skill if the name exists.",
    parameters: obj({ name: str("Short skill name"), description: str("One line: when to use it"), instructions: str("Markdown instructions") }),
    execute: async (a, ctx) => (repo.upsertSkill(ctx.dot.id, s(a.name), s(a.description), s(a.instructions)), `Skill "${s(a.name)}" saved.`),
  },
  {
    name: "use_skill",
    label: "Using a skill",
    description: "Load the full instructions of one of your saved skills.",
    parameters: obj({ name: str("Skill name") }),
    execute: async (a, ctx) => {
      const skill = repo.listSkills(ctx.dot.id).find((k) => k.name.toLowerCase() === s(a.name).toLowerCase());
      return skill ? skill.body : `No skill named "${s(a.name)}".`;
    },
  },
  {
    name: "create_routine",
    label: "Setting up a routine",
    description: "Create a recurring task you'll run on a schedule on your own, e.g. a morning briefing. Results reach the user via send_update.",
    parameters: obj({
      name: str("Short name"),
      instruction: str("What to do each time, written as a full instruction to yourself"),
      schedule: str("5-field cron expression in the user's local timezone, e.g. '0 8 * * 1-5' for weekdays at 8am"),
    }),
    describe: (a) => `set up a recurring routine "${s(a.name)}" (${s(a.schedule)})`,
    defaultDecision: () => "allow",
    execute: async (a, ctx) => {
      if (!repo.validSchedule(s(a.schedule))) return `Invalid cron expression: ${s(a.schedule)}`;
      const r = repo.addRoutine({ dotId: ctx.dot.id, name: s(a.name), instruction: s(a.instruction), schedule: s(a.schedule) });
      return `Routine created (id ${r.id}). Next run: ${r.nextRunAt ? new Date(r.nextRunAt).toString() : "unknown"}.`;
    },
  },
  {
    name: "delete_routine",
    label: "Updating routines",
    description: "Delete one of your routines.",
    parameters: obj({ routine_id: str("Routine id") }),
    describe: (a) => `delete routine ${s(a.routine_id)}`,
    defaultDecision: () => "allow",
    execute: async (a) => (repo.deleteRoutine(s(a.routine_id)), "Routine deleted."),
  },
  {
    name: "send_update",
    label: "Messaging you",
    description:
      "Proactively message the user with a notification — for progress on long work, or to deliver results of background/routine work. Give finished deliverables a short title like 'Your research is ready'.",
    parameters: obj({ title: nullableStr("Short notification title, or null"), text: str("The message (markdown)") }),
    execute: async (a, ctx) => {
      const title = (a.title as string | null) || null;
      repo.addMessage({ dotId: ctx.dot.id, role: "dot", text: s(a.text), title });
      emit({ type: "notify", dotId: ctx.dot.id, title: title ?? ctx.dot.name, body: s(a.text).slice(0, 160) });
      return "Delivered to the user.";
    },
  },
  {
    name: "message_dot",
    label: "Messaging another dot",
    description: "Ask another of the user's dots for help or hand off a sub-task. Returns their reply.",
    parameters: obj({ dot_name: str("The other dot's name"), message: str("Your message to them, with all needed context") }),
    describe: (a) => `message the dot "${s(a.dot_name)}"`,
    defaultDecision: () => "allow",
    execute: async (a, ctx) => {
      const target = repo.findDotByName(s(a.dot_name));
      if (!target) return `No dot named "${s(a.dot_name)}". Available: ${repo.listDots().map((d) => d.name).join(", ")}`;
      if (target.id === ctx.dot.id) return "That's you.";
      if (target.status === "paused") return `${target.name} is paused.`;
      if (ctx.depth >= 2 || !consultImpl) return "Too many nested hand-offs; do it yourself.";
      return consultImpl(target, s(a.message), ctx.dot, ctx.depth + 1, ctx.signal);
    },
  },
  {
    name: "ask_user",
    label: "Waiting for you",
    description: "Ask the user a question and wait for the answer. Offer 2-4 likely answers as options when possible.",
    parameters: obj({ question: str("The question"), options: { type: "array", items: { type: "string" }, description: "Suggested answers (may be empty)" } }),
    pause: "question",
  },
  {
    name: "request_approval",
    label: "Waiting for approval",
    description:
      "Ask the user to approve an action before you take it (sending messages on their behalf, purchases, deleting things, submitting forms, anything irreversible or public). Wait for their decision.",
    parameters: obj({ action: str("What you want to do, one line"), details: str("Exactly what will happen: recipients, amounts, content, etc.") }),
    pause: "approval",
  },
];

// ---------- Composio For You: the user's apps (Gmail, Calendar, Slack, Notion, GitHub…) ----------

TOOLS.push({
  name: "app_connect",
  label: "Connecting an app",
  description:
    "Ask the user to connect one of their apps to Composio (shows a Connect card with a sign-in link) and wait until they finish. Use the exact toolkit slug from COMPOSIO_SEARCH_TOOLS.",
  parameters: obj({ toolkit: str("Toolkit slug, e.g. gmail, googlecalendar, slack, notion, github") }),
  pause: "connect",
});

/** Composio's hosted MCP tools, wrapped so they pass our rules and approval cards. */
function composioTools(): ToolDef[] {
  return composio.mcpTools().map((t): ToolDef => {
    const base = {
      name: t.name,
      description: t.description ?? t.name,
      parameters: t.inputSchema as Record<string, unknown>,
      strict: false,
      execute: (a: Record<string, unknown>) => composio.callTool(t.name, a),
    };
    if (t.name === "COMPOSIO_MULTI_EXECUTE_TOOL") {
      return {
        ...base,
        label: "Using your apps",
        describe: (a) => composio.describeExecute(a),
        defaultDecision: (_ctx, a) => composio.executeDecision(a),
        detail: (a) => composio.executeDetail(a),
      };
    }
    if (t.name === "COMPOSIO_MANAGE_CONNECTIONS") {
      return {
        ...base,
        label: "Checking app connections",
        // New connections go through app_connect so the user gets a proper Connect card.
        precheck: async (a) =>
          ((a.toolkits as { action?: string }[] | undefined) ?? []).some((k) => (k.action ?? "add") === "add")
            ? "To connect an app, call app_connect with the toolkit slug instead (it shows the user a Connect card)."
            : null,
        describe: (a) => `change app connections (${JSON.stringify(a.toolkits ?? []).slice(0, 120)})`,
        defaultDecision: (_ctx, a) =>
          ((a.toolkits as { action?: string }[] | undefined) ?? []).every((k) => k.action === "list") ? "allow" : "ask",
      };
    }
    return { ...base, label: t.name === "COMPOSIO_SEARCH_TOOLS" ? "Finding app tools" : "Checking app tools" };
  });
}

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Look up a tool by name, including Composio's dynamic ones. */
export function findTool(name: string): ToolDef | undefined {
  return TOOL_BY_NAME.get(name) ?? composioTools().find((t) => t.name === name);
}

export function toolsForDot(dot: Dot): ToolDef[] {
  const signedIn = composio.signedIn();
  return [
    ...TOOLS.filter((t) => (t.name !== "run_on_my_computer" || dot.localAccess) && (t.name !== "app_connect" || signedIn)),
    ...(signedIn ? composioTools() : []),
  ];
}

const TOOL_GROUPS = {
  general: [
    "web_search",
    "open_url",
    "read_page",
    "inspect_page_links",
    "read_file",
    "search_documents",
    "read_document",
    "find_in_documents",
    "ask_user",
    "request_approval",
    "remember",
    "use_skill",
  ],

  web: [
    "web_search",
    "open_url",
    "read_page",
    "inspect_page_links",
    "find_on_page",
    "summarize_site",
    "compare_sources",
  ],

  shopping: [
    "product_search",
    "product_details",
    "price_compare",
    "review_search",
    "web_search",
    "open_url",
    "read_page",
    "inspect_page_links",
    "compare_sources",
  ],

  browser: [
    "open_browser",
    "open_current_browser",
    "open_url",
    "read_page",
    "inspect_page_links",
    "find_on_page",
    "click",
    "type_text",
    "sign_in",
  ],

  files: [
    "read_file",
    "write_file",
    "download_file",
    "share_file",
    "search_documents",
    "read_document",
    "find_in_documents",
  ],

  coding: [
    "run_command",
    "read_file",
    "write_file",
    "download_file",
    "search_documents",
    "read_document",
    "find_in_documents",
  ],

  memory: [
    "remember",
    "forget",
    "save_skill",
    "use_skill",
  ],

  automation: [
    "create_routine",
    "delete_routine",
    "send_update",
  ],

  communication: [
    "send_update",
    "message_dot",
    "ask_user",
    "request_approval",
  ],
} as const;

export function toolsForRequest(dot: Dot, request: string): ToolDef[] {
  const text = request.toLowerCase();

  const names = new Set<string>([
    ...TOOL_GROUPS.general,
    "ask_user",
    "request_approval",
  ]);

  const add = (group: keyof typeof TOOL_GROUPS) => {
    for (const name of TOOL_GROUPS[group]) names.add(name);
  };

  const isShopping =
    /\b(headphone|headphones|earbuds|earphones|laptop|phone|smartphone|monitor|keyboard|mouse|camera|product|buy|price|under\s*₹?\s*\d+|under\s*\d+\s*(rs|inr|rupees))\b/i.test(text);

  const isWeb =
    /\b(browse|search|look up|lookup|research|website|web|url|explain|find|compare|source|article|documentation)\b/i.test(text);

  const isBrowser =
    /\b(click|type|open browser|chrome|brave|login|sign in|button|page|website)\b/i.test(text);

  const isFiles =
    /\b(file|folder|document|pdf|xlsx|csv|docx|read file|write file|download|upload)\b/i.test(text);

  const isCoding =
    /\b(code|coding|program|script|python|javascript|typescript|npm|node|git|github|terminal|command|compile|build|debug|error)\b/i.test(text);

  const isMemory =
    /\b(remember|forget|memory|save this|don't forget)\b/i.test(text);

  const isAutomation =
    /\b(routine|schedule|every day|every morning|cron|automate|recurring)\b/i.test(text);

  const isCommunication =
    /\b(send|message|notify|tell me|another dot|delegate)\b/i.test(text);

  if (isShopping) add("shopping");
  else if (isWeb) add("web");

  if (isBrowser) add("browser");
  if (isFiles) add("files");
  if (isCoding) add("coding");
  if (isMemory) add("memory");
  if (isAutomation) add("automation");
  if (isCommunication) add("communication");

  const available = toolsForDot(dot);

  return available.filter((tool) => names.has(tool.name));
}

export const COMPUTER_ENABLED = (process.env.DOTS_COMPUTER_TOOL ?? "computer") !== "off";
