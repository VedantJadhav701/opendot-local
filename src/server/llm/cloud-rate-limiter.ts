import "server-only";

export type RateLimiterConfig = {
  rpm?: number;
  maxPerTurn?: number;
};

export class CloudRateLimiter {
  private rpm: number;
  private maxPerTurn: number;
  private tokens: number;
  private lastRefill: number;
  private queue: (() => void)[] = [];
  private processingQueue = false;
  private turnCallCounts = new Map<string, number>();

  constructor(config: RateLimiterConfig = {}) {
    this.rpm = config.rpm ?? 40;
    this.maxPerTurn = config.maxPerTurn ?? 5;
    this.tokens = this.rpm;
    this.lastRefill = Date.now();
  }

  setRpm(rpm: number) {
    this.rpm = Math.max(1, rpm);
  }

  setMaxPerTurn(max: number) {
    this.maxPerTurn = Math.max(1, max);
  }

  resetTurnBudget(dotId: string) {
    this.turnCallCounts.delete(dotId);
  }

  checkTurnBudget(dotId: string): boolean {
    const current = this.turnCallCounts.get(dotId) ?? 0;
    return current < this.maxPerTurn;
  }

  incrementTurnCount(dotId: string) {
    const current = this.turnCallCounts.get(dotId) ?? 0;
    this.turnCallCounts.set(dotId, current + 1);
  }

  private refillTokens() {
    const now = Date.now();
    const elapsedMs = now - this.lastRefill;
    const refillTokens = (elapsedMs / 60000) * this.rpm;
    if (refillTokens > 0) {
      this.tokens = Math.min(this.rpm, this.tokens + refillTokens);
      this.lastRefill = now;
    }
  }

  async acquire(dotId?: string): Promise<number> {
    if (dotId && !this.checkTurnBudget(dotId)) {
      throw new Error(`Cloud rate limit: Exceeded max cloud calls per turn (${this.maxPerTurn})`);
    }

    const startWait = Date.now();
    this.refillTokens();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      if (dotId) this.incrementTurnCount(dotId);
      return 0;
    }

    // Wait in queue for token refill
    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.processQueue();
    });

    const waitTimeMs = Date.now() - startWait;
    console.log(`[cloud-rate-limiter] Request acquired after wait time: ${waitTimeMs}ms`);
    if (dotId) this.incrementTurnCount(dotId);
    return waitTimeMs;
  }

  private async processQueue() {
    if (this.processingQueue) return;
    this.processingQueue = true;

    while (this.queue.length > 0) {
      this.refillTokens();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        const next = this.queue.shift();
        if (next) next();
      } else {
        // Sleep until next token is available
        const msToNextToken = Math.ceil((1 / this.rpm) * 60000);
        await new Promise((r) => setTimeout(r, Math.max(50, msToNextToken)));
      }
    }

    this.processingQueue = false;
  }

  async handleRetryAfter(retryAfterHeader: string | null): Promise<void> {
    let delayMs = 2000; // default 2s backoff
    if (retryAfterHeader) {
      const seconds = parseInt(retryAfterHeader, 10);
      if (!isNaN(seconds)) {
        delayMs = seconds * 1000;
      } else {
        const date = new Date(retryAfterHeader).getTime();
        if (!isNaN(date)) {
          delayMs = Math.max(100, date - Date.now());
        }
      }
    }
    console.log(`[cloud-rate-limiter] 429 Rate limited. Backoff retry after ${delayMs}ms`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

export const cloudLimiter = new CloudRateLimiter();
