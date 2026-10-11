import { proxy } from "./proxy";
import { NextRequest } from "next/server";

async function runTests() {
  console.log("=== Testing Proxy Host & Origin Guard ===");

  // 1. Allowed host passes
  const reqAllowed = new NextRequest("http://127.0.0.1:3100/api/health", {
    headers: { host: "127.0.0.1:3100" },
  });
  const resAllowed = proxy(reqAllowed);
  if (resAllowed.status === 403) {
    throw new Error("Test 1 Failed: Allowed 127.0.0.1:3100 got 403!");
  }
  console.log("PASS: 127.0.0.1:3100 passed.");

  // 2. Localhost host passes
  const reqLocalhost = new NextRequest("http://localhost:3100/api/health", {
    headers: { host: "localhost:3100" },
  });
  const resLocalhost = proxy(reqLocalhost);
  if (resLocalhost.status === 403) {
    throw new Error("Test 2 Failed: Allowed localhost:3100 got 403!");
  }
  console.log("PASS: localhost:3100 passed.");

  // 3. Evil.example host gets 403
  const reqEvil = new NextRequest("http://127.0.0.1:3100/api/health", {
    headers: { host: "evil.example:3100" },
  });
  const resEvil = proxy(reqEvil);
  if (resEvil.status !== 403) {
    throw new Error(`Test 3 Failed: evil.example was not blocked! Status: ${resEvil.status}`);
  }
  console.log("PASS: evil.example was blocked with 403.");

  // 4. Cross-origin POST gets 403
  const reqCrossPost = new NextRequest("http://127.0.0.1:3100/api/dots/default/input", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3100",
      origin: "http://attacker.example",
    },
  });
  const resCrossPost = proxy(reqCrossPost);
  if (resCrossPost.status !== 403) {
    throw new Error(`Test 4 Failed: Cross-origin POST was not blocked! Status: ${resCrossPost.status}`);
  }
  console.log("PASS: Cross-origin POST was blocked with 403.");

  // 5. Allowed-origin POST passes
  const reqGoodPost = new NextRequest("http://127.0.0.1:3100/api/dots/default/input", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3100",
      origin: "http://127.0.0.1:3100",
    },
  });
  const resGoodPost = proxy(reqGoodPost);
  if (resGoodPost.status === 403) {
    throw new Error("Test 5 Failed: Same-origin POST was incorrectly blocked!");
  }
  console.log("PASS: Same-origin POST passed.");

  console.log("All Proxy Host & Origin Unit Tests PASSED!");
}

runTests();
