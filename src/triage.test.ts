import { describe, expect, test } from "bun:test";
import {
  checkSeverityThreshold,
  buildTriagePrompt,
  parseTriageResponse,
  triage,
} from "./triage.ts";
import type { StructuredAssessment } from "./types.ts";

describe("checkSeverityThreshold", () => {
  test("below threshold — fails", () => {
    const result = checkSeverityThreshold(2, 3);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("below threshold");
  });

  test("at threshold — passes", () => {
    const result = checkSeverityThreshold(3, 3);
    expect(result.passed).toBe(true);
  });

  test("above threshold — passes", () => {
    const result = checkSeverityThreshold(5, 3);
    expect(result.passed).toBe(true);
  });
});

describe("buildTriagePrompt", () => {
  test("contains assessment and principle text", () => {
    const prompt = buildTriagePrompt("The code has duplication.", "DRY");
    expect(prompt).toContain("The code has duplication.");
    expect(prompt).toContain("DRY");
    expect(prompt).toContain("skeptical");
  });
});

describe("parseTriageResponse", () => {
  test("parses well-formed fenced response", () => {
    const raw = '```json\n{ "changeType": "architecture", "busyWork": false, "reason": "Substantive refactor" }\n```';
    const result = parseTriageResponse(raw);
    expect(result.changeType).toBe("architecture");
    expect(result.busyWork).toBe(false);
    expect(result.reason).toBe("Substantive refactor");
  });

  test("parses bare JSON response", () => {
    const raw = '{ "changeType": "cosmetic", "busyWork": true, "reason": "Just renaming" }';
    const result = parseTriageResponse(raw);
    expect(result.changeType).toBe("cosmetic");
    expect(result.busyWork).toBe(true);
    expect(result.reason).toBe("Just renaming");
  });

  test("fail-open on malformed response", () => {
    const raw = "This is not JSON at all.";
    const result = parseTriageResponse(raw);
    expect(result.busyWork).toBe(false); // fail-open
    expect(result.changeType).toBe("other");
  });

  test("fail-open on invalid JSON", () => {
    const raw = '```json\n{invalid}\n```';
    const result = parseTriageResponse(raw);
    expect(result.busyWork).toBe(false); // fail-open
  });
});

describe("triage", () => {
  const makeAssessment = (severity: number): StructuredAssessment => ({
    severity,
    principle: "Single Responsibility",
    category: "architecture",
    prose: "The module handles too many concerns.",
    raw: "raw assessment text",
  });

  test("low severity — rejected without LLM call", async () => {
    let claudeCalled = false;
    const mockClaude = async () => {
      claudeCalled = true;
      return "";
    };

    const result = await triage(makeAssessment(1), 3, "haiku", "Read Glob Grep", mockClaude);

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("below threshold");
    expect(claudeCalled).toBe(false);
  });

  test("high severity + busy-work — rejected", async () => {
    const mockClaude = async () =>
      '```json\n{ "changeType": "cosmetic", "busyWork": true, "reason": "Just adding comments" }\n```';

    const result = await triage(makeAssessment(4), 3, "haiku", "Read Glob Grep", mockClaude);

    expect(result.accepted).toBe(false);
    expect(result.busyWork).toBe(true);
    expect(result.reason).toContain("Busy-work");
  });

  test("high severity + substantive — accepted", async () => {
    const mockClaude = async () =>
      '```json\n{ "changeType": "architecture", "busyWork": false, "reason": "Genuine SRP violation" }\n```';

    const result = await triage(makeAssessment(4), 3, "haiku", "Read Glob Grep", mockClaude);

    expect(result.accepted).toBe(true);
    expect(result.busyWork).toBe(false);
    expect(result.changeType).toBe("architecture");
  });

  test("at threshold + substantive — accepted", async () => {
    const mockClaude = async () =>
      '```json\n{ "changeType": "bugfix", "busyWork": false, "reason": "Real bug" }\n```';

    const result = await triage(makeAssessment(3), 3, "haiku", "Read Glob Grep", mockClaude);

    expect(result.accepted).toBe(true);
  });
});
