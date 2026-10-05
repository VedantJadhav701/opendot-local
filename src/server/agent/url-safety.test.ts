import { validateUrlSafety, isPrivateIp, fetchSafe } from "./url-safety";

async function runItem2Tests() {
  console.log("=== Testing Item 2: URL Safety & Redirect Validation ===");

  const blockedCases = [
    { url: "file:///C:/Windows/System32", reason: "file protocol" },
    { url: "ftp://example.com/file.txt", reason: "ftp protocol" },
    { url: "http://localhost:3000", reason: "localhost host" },
    { url: "http://test.localhost", reason: ".localhost host" },
    { url: "http://mydevice.local", reason: ".local host" },
    { url: "http://127.0.0.1:8080", reason: "127.0.0.0/8 loopback" },
    { url: "http://127.255.255.254", reason: "127.0.0.0/8 subnet" },
    { url: "http://10.0.0.1", reason: "10.0.0.0/8 private" },
    { url: "http://10.254.1.10", reason: "10.0.0.0/8 subnet" },
    { url: "http://172.16.0.1", reason: "172.16.0.0/12 private" },
    { url: "http://172.31.255.255", reason: "172.16.0.0/12 boundary" },
    { url: "http://192.168.1.1", reason: "192.168.0.0/16 private" },
    { url: "http://169.254.169.254/latest/meta-data/", reason: "169.254.0.0/16 link-local metadata" },
    { url: "http://0.0.0.0:8000", reason: "0.0.0.0/8 unspecified" },
    { url: "http://[::1]:8000", reason: "IPv6 ::1 loopback" },
    { url: "http://[fe80::1]", reason: "IPv6 link-local" },
    { url: "http://[fc00::1]", reason: "IPv6 unique local" },
    { url: "http://[::ffff:127.0.0.1]", reason: "IPv4-mapped IPv6 loopback" },
    { url: "http://[::ffff:10.0.0.1]", reason: "IPv4-mapped IPv6 private" },
  ];

  for (const c of blockedCases) {
    const res = await validateUrlSafety(c.url);
    if (res.safe) {
      throw new Error(`FAIL: "${c.url}" (${c.reason}) was NOT blocked!`);
    }
    console.log(`PASS: Blocked "${c.url}" (${c.reason}) -> ${res.reason}`);
  }

  const allowedCases = [
    "https://example.com",
    "http://1.1.1.1",
    "https://8.8.8.8",
  ];

  for (const url of allowedCases) {
    const res = await validateUrlSafety(url);
    if (!res.safe) {
      throw new Error(`FAIL: Allowed URL "${url}" was blocked: ${res.reason}`);
    }
    console.log(`PASS: Allowed "${url}" -> resolved IP ${res.resolvedIp}`);
  }

  // Test fetchSafe redirect security
  try {
    await fetchSafe("http://127.0.0.1:8080");
    throw new Error("FAIL: fetchSafe allowed loopback request");
  } catch (err: any) {
    if (!err.message.includes("Security error")) throw err;
    console.log("PASS: fetchSafe blocked private IP access with Security error.");
  }

  console.log("All Item 2 URL Safety Tests PASSED!");
}

runItem2Tests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
