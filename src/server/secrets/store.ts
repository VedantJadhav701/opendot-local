import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DATA_DIR } from "../db";

const SERVICE = "open-dot-local-vault";
const g = globalThis as unknown as { __openDotVaultKey?: Buffer };

export function masterKey(): Buffer {
  if (g.__openDotVaultKey) return g.__openDotVaultKey;
  let hex: string | null = null;

  if (process.platform === "darwin") {
    try {
      hex = execFileSync("security", ["find-generic-password", "-s", SERVICE, "-a", "master", "-w"], {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      hex = crypto.randomBytes(32).toString("hex");
      try {
        execFileSync("security", ["add-generic-password", "-s", SERVICE, "-a", "master", "-w", hex, "-U"], {
          stdio: "ignore",
        });
      } catch {
        hex = null;
      }
    }
  } else if (process.platform === "win32") {
    try {
      const psScript = `
        $key = [System.Security.Cryptography.ProtectedData]::Unprotect(
          [System.Convert]::FromBase64String((Get-ItemProperty -Path "HKCU:\\Software\\OpenDot" -Name "VaultKey" -ErrorAction SilentlyContinue).VaultKey),
          $null,
          [System.Security.Cryptography.DataProtectionScope]::CurrentUser
        )
        [System.Convert]::ToHexString($key)
      `;
      hex = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psScript], {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      try {
        const genHex = crypto.randomBytes(32).toString("hex");
        const psSaveScript = `
          $bytes = [System.Text.Encoding]::UTF8.GetBytes("${genHex}")
          $protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
          $b64 = [System.Convert]::ToBase64String($protected)
          New-Item -Path "HKCU:\\Software\\OpenDot" -Force | Out-Null
          Set-ItemProperty -Path "HKCU:\\Software\\OpenDot" -Name "VaultKey" -Value $b64
        `;
        execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psSaveScript], { stdio: "ignore" });
        hex = genHex;
      } catch {
        hex = null;
      }
    }
  }

  if (!hex) {
    const file = path.join(DATA_DIR, "vault.key");
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
    hex = fs.readFileSync(file, "utf8").trim();
  }

  g.__openDotVaultKey = Buffer.from(hex, "hex");
  return g.__openDotVaultKey;
}

export function sealSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function unsealSecret(sealed: string): string {
  const [iv, tag, data] = sealed.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
