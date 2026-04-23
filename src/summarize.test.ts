import { describe, expect, test } from "bun:test";
import {
  buildIterateSummarizePrompt,
  buildMaintainSummarizePrompt,
  parseSummarizeResponse,
  summarize,
} from "./summarize.ts";

describe("buildIterateSummarizePrompt", () => {
  test("includes principle, severity, and execution excerpt", () => {
    const prompt = buildIterateSummarizePrompt({
      name: "fix-auth-bug",
      structuredAssessment: {
        severity: 4,
        principle: "Single Responsibility",
        category: "architecture",
        prose: "The module does too much.",
        raw: "raw assessment",
      },
      triageResult: {
        accepted: true,
        reason: "Substantive",
        severity: 4,
        changeType: "architecture",
        busyWork: false,
      },
      execution: "Extracted auth logic into separate module.",
      retries: 0,
      gatesResult: {
        allPassed: true,
        requiredPassed: true,
        results: [],
      },
    });

    expect(prompt).toContain("Single Responsibility");
    expect(prompt).toContain("4/5");
    expect(prompt).toContain("architecture");
    expect(prompt).toContain("Extracted auth logic");
    expect(prompt).toContain("JSON");
  });

  test("handles null assessment and triage gracefully", () => {
    const prompt = buildIterateSummarizePrompt({
      name: "test",
      structuredAssessment: null,
      triageResult: null,
      execution: "Did some work.",
      retries: 0,
      gatesResult: null,
    });

    expect(prompt).toContain("unknown");
    expect(prompt).toContain("no gates configured");
  });

  test("truncates execution to 500 chars", () => {
    const longExecution = "x".repeat(1000);
    const prompt = buildIterateSummarizePrompt({
      name: "test",
      structuredAssessment: null,
      triageResult: null,
      execution: longExecution,
      retries: 0,
      gatesResult: null,
    });

    // The excerpt should be 500 chars, not the full 1000
    const excerptLine = prompt.split("\n").find((l) => l.startsWith("xxx"));
    expect(excerptLine?.length).toBe(500);
  });
});

describe("buildMaintainSummarizePrompt", () => {
  test("includes execution excerpt and retries", () => {
    const prompt = buildMaintainSummarizePrompt({
      name: "maintain-2026-02-15-091500",
      execution: "Updated typescript from 5.3 to 5.4.",
      retries: 1,
      gatesResult: {
        allPassed: true,
        requiredPassed: true,
        results: [],
      },
    });

    expect(prompt).toContain("dependency maintenance");
    expect(prompt).toContain("Retries: 1");
    expect(prompt).toContain("Updated typescript");
    expect(prompt).toContain("JSON");
  });

  test("shows gate failure count", () => {
    const prompt = buildMaintainSummarizePrompt({
      name: "maintain-test",
      execution: "Updated deps.",
      retries: 0,
      gatesResult: {
        allPassed: false,
        requiredPassed: true,
        results: [
          { name: "test", command: "bun test", passed: true, required: true, output: "ok", exitCode: 0 },
          { name: "security", command: "npm audit", passed: false, required: false, output: "2 vulns", exitCode: 1 },
        ],
      },
    });

    expect(prompt).toContain("1 gate(s) failed");
  });
});

describe("parseSummarizeResponse", () => {
  test("parses valid JSON response", () => {
    const result = parseSummarizeResponse(
      '```json\n{ "headline": "Fix auth module SRP violation", "summary": "Extracted auth into its own module." }\n```',
    );

    expect(result).not.toBeNull();
    expect(result?.headline).toBe("Fix auth module SRP violation");
    expect(result?.summary).toBe("Extracted auth into its own module.");
  });

  test("returns null for missing fields", () => {
    const result = parseSummarizeResponse('{ "headline": "Only headline" }');
    expect(result).toBeNull();
  });

  test("returns null for non-JSON", () => {
    const result = parseSummarizeResponse("This is not JSON at all.");
    expect(result).toBeNull();
  });

  test("handles bare JSON (no fences)", () => {
    const result = parseSummarizeResponse('{ "headline": "Update deps to latest", "summary": "Bumped all packages." }');

    expect(result).not.toBeNull();
    expect(result?.headline).toBe("Update deps to latest");
  });
});

describe("summarize", () => {
  test("returns parsed result from Claude", async () => {
    const mockClaude = async () =>
      '```json\n{ "headline": "Fix SRP violation in auth", "summary": "Split module." }\n```';

    const result = await summarize("Generate a headline...", {
      model: "haiku",
      readOnlyTools: "Read Glob Grep WebFetch WebSearch",
      claude: mockClaude,
    });

    expect(result).not.toBeNull();
    expect(result?.headline).toBe("Fix SRP violation in auth");
    expect(result?.summary).toBe("Split module.");
  });

  test("returns null on unparseable output", async () => {
    const mockClaude = async () => "I cannot generate JSON right now.";

    const result = await summarize("Generate a headline...", {
      model: "haiku",
      readOnlyTools: "Read Glob Grep WebFetch WebSearch",
      claude: mockClaude,
    });

    expect(result).toBeNull();
  });

  test("does not include --agent in args", async () => {
    let capturedArgs: string[] = [];
    const mockClaude = async (args: string[]) => {
      capturedArgs = args;
      return '{ "headline": "h", "summary": "s" }';
    };

    await summarize("prompt", { model: "haiku", readOnlyTools: "Read Glob Grep", claude: mockClaude });

    expect(capturedArgs).not.toContain("--agent");
  });

  test("includes --allowedTools in args", async () => {
    let capturedArgs: string[] = [];
    const mockClaude = async (args: string[]) => {
      capturedArgs = args;
      return '{ "headline": "h", "summary": "s" }';
    };

    await summarize("prompt", { model: "haiku", readOnlyTools: "Read Glob Grep", claude: mockClaude });

    expect(capturedArgs).toContain("--allowedTools");
  });
});
