import "server-only";
import { sealSecret, unsealSecret } from "./secrets";
import { insertPassword, sealedPasswordFor } from "./repo";

export function seal(plain: string): string {
  return sealSecret(plain);
}

export function unseal(sealed: string): string {
  return unsealSecret(sealed);
}

export function savePassword(site: string, username: string, password: string) {
  return insertPassword(site.trim(), username.trim(), seal(password));
}

export function credentialFor(site: string): { site: string; username: string; password: string } | null {
  const row = sealedPasswordFor(site);
  return row ? { site: row.site, username: row.username, password: unseal(row.sealed) } : null;
}
