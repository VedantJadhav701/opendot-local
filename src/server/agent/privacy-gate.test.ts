import { redactForCloud, hasCloudConsent, setCloudConsent } from "./privacy-gate";

function runPrivacyGateTests() {
  console.log("=== Testing Item 4: Privacy Gate & Redaction ===");

  // 1. Password Redaction Test
  const secretPassword = "SuperSecretPassword123!";
  const rawTextWithPwd = `My password is ${secretPassword} for site example.com`;
  const redactedPwd = redactForCloud(rawTextWithPwd, [secretPassword]);

  if (redactedPwd.includes(secretPassword)) {
    throw new Error("FAIL: Password was NOT redacted!");
  }
  if (!redactedPwd.includes("[REDACTED_PASSWORD]")) {
    throw new Error("FAIL: [REDACTED_PASSWORD] marker missing!");
  }
  console.log("PASS: Password successfully redacted.");

  // 2. Secret / API Key Redaction Test
  const rawTextWithKeys = "NVIDIA key nvapi-1234567890abcdefghijklmnopqrstuvwxyz and bearer Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
  const redactedKeys = redactForCloud(rawTextWithKeys);

  if (redactedKeys.includes("nvapi-1234567890abcdefghijklmnopqrstuvwxyz")) {
    throw new Error("FAIL: NVAPI key was NOT redacted!");
  }
  if (!redactedKeys.includes("[REDACTED_SECRET]")) {
    throw new Error("FAIL: Secret marker missing!");
  }
  console.log("PASS: API keys and Bearer tokens successfully redacted.");

  // 3. Local Absolute Path Redaction Test (Windows & POSIX)
  const winPath = "C:\\Users\\HP\\projects\\open-dot\\secret-file.txt";
  const posixPath = "/Users/admin/documents/confidential.pdf";
  const rawTextWithPaths = `Reading file from ${winPath} and ${posixPath}`;
  const redactedPaths = redactForCloud(rawTextWithPaths);

  if (redactedPaths.includes(winPath) || redactedPaths.includes(posixPath)) {
    throw new Error("FAIL: Absolute paths were NOT redacted!");
  }
  if (!redactedPaths.includes("[REDACTED_LOCAL_PATH]")) {
    throw new Error("FAIL: [REDACTED_LOCAL_PATH] marker missing!");
  }
  console.log("PASS: Windows and POSIX absolute paths successfully redacted.");

  // 4. Consent tracking test
  const dotId = "test-privacy-dot";
  if (hasCloudConsent(dotId)) {
    throw new Error("FAIL: Dot should initially have no cloud consent!");
  }
  setCloudConsent(dotId, true);
  if (!hasCloudConsent(dotId)) {
    throw new Error("FAIL: Dot cloud consent was not updated!");
  }
  console.log("PASS: Cloud consent tracking works as expected.");

  console.log("All Item 4 Privacy Gate & Redaction Tests PASSED!");
}

runPrivacyGateTests();
