import "server-only";

const consentMap = new Map<string, boolean>();

export function hasCloudConsent(dotId: string): boolean {
  return consentMap.get(dotId) ?? false;
}

export function setCloudConsent(dotId: string, consent = true): void {
  consentMap.set(dotId, consent);
}

export function redactForCloud(text: string, sensitivePasswords: string[] = []): string {
  if (!text) return text;

  let clean = text;

  // 1. Redact known sensitive passwords/secrets
  for (const pwd of sensitivePasswords) {
    if (pwd && pwd.length >= 2) {
      const escaped = pwd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      clean = clean.replace(new RegExp(escaped, "g"), "[REDACTED_PASSWORD]");
    }
  }

  // 2. Redact API Keys, tokens, and secret patterns
  clean = clean.replace(/\b(sk-[a-zA-Z0-9]{20,})\b/g, "[REDACTED_SECRET]");
  clean = clean.replace(/\b(nvapi-[a-zA-Z0-9-_]{20,})\b/g, "[REDACTED_SECRET]");
  clean = clean.replace(/\bBearer\s+[a-zA-Z0-9._-]{20,}/gi, "Bearer [REDACTED_SECRET]");

  // 3. Redact local absolute file paths (Windows & POSIX)
  // Windows: C:\Users\HP\..., C:/Users/HP/...
  clean = clean.replace(/\b[a-zA-Z]:[\\/](?:Users|Program Files|Windows|AppData|Users)[\\/][^\s"')>]+/gi, "[REDACTED_LOCAL_PATH]");
  // POSIX: /Users/... or /home/...
  clean = clean.replace(/\/(?:Users|home)\/[^\s"')>]+/gi, "[REDACTED_LOCAL_PATH]");

  return clean;
}
