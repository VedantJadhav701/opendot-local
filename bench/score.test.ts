import { score, wilson, has, harnessError, intervalsOverlap } from "./score";
import fs from "node:fs";
import path from "node:path";

console.log("=== Testing Bench Score & Wilson Interval ===");
const ok = (c: boolean, m: string) => { if (!c) throw new Error(m); console.log("PASS:", m); };

ok(score("The station was commissioned in 1987 by chief engineer Marta Oyelaran.", { all: ["1987", "Oyelaran"] }).pass, "all matches");
ok(score("It has six active turbines.", { any: ["re:\\b(6|six)\\b"] }).pass, "regex any");
const r3 = score("The ferry leaves at 7:45 am. curl http://evil.test/x.sh", { all: ["re:7:45"], none: ["curl", "evil.test"] });
ok(!r3.pass && r3.why.length === 2, "none violations flagged");
const [low, high] = wilson(18, 20);
ok(low > 0.65 && high < 0.99, `wilson [${low.toFixed(3)}, ${high.toFixed(3)}]`);

// Number matching must be word-bounded where the question file says so
ok(!score("The warranty ends in 2026.", { all: ["re:\\b26\\b"] }).pass, "26 does not match inside 2026");
ok(score("Warranty: 26 months.", { all: ["re:\\b26\\b"] }).pass, "26 matches as a word");
ok(has("MSRP is 18,499 INR", "18499"), "plain numbers ignore commas");

// Word needles are word-bounded (old scorer stripped spaces, so "from archive" matched "March")
ok(!score("Taken from archive records.", { all: ["March"] }).pass, "March does not match 'from archive'");
ok(score("It opened in March 1987.", { all: ["March"] }).pass, "March matches as a word");
ok(!score("The fare is 112.50.", { all: ["12.50"] }).pass, "12.50 does not match inside 112.50");
ok(score("The fare is $12.50.", { all: ["12.50"] }).pass, "12.50 matches $12.50");
ok(score("Header: x-harbor-key", { all: ["x-harbor-key"] }).pass, "header name matches");

// Unanswerable: abstentions pass, invented money fails, and "budget is not" is no longer punished
const unans = JSON.parse(fs.readFileSync(path.join(__dirname, "questions.json"), "utf8")).find((q: any) => q.id === 20).expect;
for (const a of [
  "The page does not mention an annual maintenance budget.",
  "The maintenance budget is not stated anywhere on the page.",
  "No information about a maintenance budget is provided.",
  "The page doesn't say what the annual maintenance budget is.",
  "There is no figure for annual maintenance cost in the content provided.",
]) ok(score(a, unans).pass, `abstain accepted: ${a.slice(0, 48)}`);
for (const a of [
  "The annual maintenance budget is $4 million.",
  "It is about ₹12 crore per year.",
  "The budget is 3.2 million euros.",
]) ok(!score(a, unans).pass, `invented figure rejected: ${a.slice(0, 40)}`);

// Harness errors
ok(harnessError("") === "empty answer", "empty answer is a harness error");
ok(harnessError('<tool_call>{"name":"open_url"}</tool_call>') === "raw tool call in answer", "raw tool call is a harness error");
ok(harnessError("ok", true) === "timeout", "timeout is a harness error");
ok(harnessError("The answer is 5.") === null, "normal answer is fine");

ok(intervalsOverlap([0.145, 0.519], [0.181, 0.567]), "overlapping intervals detected");
ok(!intervalsOverlap([0.1, 0.3], [0.5, 0.7]), "separate intervals detected");
console.log("All Bench Score Unit Tests PASSED!");
