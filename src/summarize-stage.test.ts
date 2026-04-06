import { describe, expect, test } from "bun:test";
import { runSummarizeStage } from "./summarize-stage.ts";
import { getDefaultConfig } from "./config.ts";
import type { PipelineContext } from "./types.ts";

function makeCtx(
  claude: PipelineContext["claude"],
  onProgress: PipelineContext["onProgress"] = () => {},
): PipelineContext {
  return {
    agent: "test-agent",
    folder: "/test",
    config: getDefaultConfig(),
    claude,
    onProgress,
  };
}

describe("runSummarizeStage", () => {
  test("returns headline and summary on success", async () => {
    const mockClaude = async () =>
      '```json\n{ "headline": "Fix SRP violation", "summary": "Extracted auth module." }\n```';

    const result = await runSummarizeStage(
      () => "Generate a headline and summary...",
      makeCtx(mockClaude),
    );

    expect(result.headline).toBe("Fix SRP violation");
    expect(result.summary).toBe("Extracted auth module.");
  });

  test("returns nulls when summarize returns null (unparseable output)", async () => {
    const mockClaude = async () => "I cannot generate JSON right now.";

    const result = await runSummarizeStage(
      () => "Generate a headline...",
      makeCtx(mockClaude),
    );

    expect(result.headline).toBeNull();
    expect(result.summary).toBeNull();
  });

  test("returns nulls and does not throw when claude throws", async () => {
    const mockClaude = async (): Promise<string> => {
      throw new Error("Claude API unavailable");
    };

    const result = await runSummarizeStage(
      () => "Generate a headline...",
      makeCtx(mockClaude),
    );

    expect(result.headline).toBeNull();
    expect(result.summary).toBeNull();
  });

  test("calls onProgress with summarize stage and message", async () => {
    const mockClaude = async () =>
      '{ "headline": "Fix something", "summary": "Did it." }';

    const progressCalls: Array<[string, string]> = [];
    await runSummarizeStage(
      () => "Generate a headline...",
      makeCtx(mockClaude, (stage, message) => progressCalls.push([stage, message])),
    );

    expect(progressCalls.length).toBe(1);
    expect(progressCalls[0]![0]).toBe("summarize");
    expect(progressCalls[0]![1]).toBe("Generating headline and summary...");
  });

  test("calls buildPrompt to construct the prompt", async () => {
    let capturedArgs: string[] = [];
    const mockClaude = async (args: string[]) => {
      capturedArgs = args;
      return '{ "headline": "h", "summary": "s" }';
    };

    await runSummarizeStage(
      () => "Custom prompt content",
      makeCtx(mockClaude),
    );

    expect(capturedArgs).toContain("Custom prompt content");
  });

  test("returns nulls and does not throw when buildPrompt throws", async () => {
    const mockClaude = async () => '{ "headline": "h", "summary": "s" }';

    const result = await runSummarizeStage(
      () => { throw new Error("prompt builder failed"); },
      makeCtx(mockClaude),
    );

    expect(result.headline).toBeNull();
    expect(result.summary).toBeNull();
  });
});
