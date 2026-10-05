import { isPrivateIp, validateUrlSafety } from "./url-safety";
import { checkHardDeny } from "./review";

async function runHardeningTests() {
  console.log("=== Testing Task a: Security Hardening & P0 Tests ===");

  // 1. IPv6-mapped IPv4 & Decimal / Hex IPs & CGNAT 100.64/10
  console.log("--- 1. IP Hardening Tests ---");
  const ipCases = [
    { ip: "::ffff:127.0.0.1", label: "IPv6-mapped loopback", blocked: true },
    { ip: "::ffff:10.0.0.1", label: "IPv6-mapped private", blocked: true },
    { ip: "2130706433", label: "Decimal IP (127.0.0.1)", blocked: true },
    { ip: "100.64.0.1", label: "CGNAT 100.64.0.0/10 start", blocked: true },
    { ip: "100.127.255.254", label: "CGNAT 100.64.0.0/10 end", blocked: true },
    { ip: "1.1.1.1", label: "Public Cloudflare IP", blocked: false },
  ];

  for (const c of ipCases) {
    const isPrivate = isPrivateIp(c.ip);
    if (isPrivate !== c.blocked) {
      throw new Error(`FAIL: IP "${c.ip}" (${c.label}) expected blocked=${c.blocked}, got ${isPrivate}`);
    }
    console.log(`PASS: IP "${c.ip}" (${c.label}) private check = ${isPrivate}`);
  }

  // 2. Deny-list Command Aliases & UNC / ADS Paths
  console.log("--- 2. Command Alias & UNC/ADS Hardening Tests ---");
  const commandCases = [
    { cmd: "rm.exe -rf /", label: "rm.exe alias" },
    { cmd: "del.exe /f /s C:\\", label: "del.exe alias" },
    { cmd: "rmdir.exe /s /q C:\\", label: "rmdir.exe alias" },
    { cmd: "reg.exe add HKLM\\Software", label: "reg.exe alias" },
    { cmd: "Set-ItemProperty -Path HKCU:\\Software", label: "Set-ItemProperty" },
    { cmd: "echo payload > \\\\server\\share\\evil.exe", label: "UNC Path \\\\server\\share" },
    { cmd: "echo payload > file.txt:secret.exe", label: "NTFS Alternate Data Stream file:stream" },
  ];

  for (const c of commandCases) {
    const reason = checkHardDeny(c.cmd);
    if (!reason) {
      throw new Error(`FAIL: Command "${c.cmd}" (${c.label}) was NOT matched by checkHardDeny!`);
    }
    console.log(`PASS: Matched "${c.cmd}" (${c.label}) -> ${reason}`);
  }

  console.log("All Security Hardening P0 Tests PASSED!");
}

runHardeningTests().catch((err) => {
  console.error("Hardening test failed:", err);
  process.exit(1);
});
