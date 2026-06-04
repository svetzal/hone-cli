import { describe, expect, test } from "bun:test";
import { buildDerivePrompt } from "./derive.ts";
import { buildDeriveGatesPrompt } from "./derive-gates.ts";
import { buildMaintainPrompt } from "./maintain.ts";
import { buildGatesMixPrompt, buildPrinciplesMixPrompt } from "./mix.ts";
import { buildExecutePrompt, runAssessStage, runNameStage, runPlanStage } from "./pipeline.ts";
import type { ProjectContext } from "./project-context.ts";
import { PROMPT_ANCHORS } from "./prompt-anchors.ts";
import { RECURSION_GUARD } from "./recursion-guard.ts";
import { buildIterateSummarizePrompt, buildMaintainSummarizePrompt } from "./summarize.ts";
import { buildTriagePrompt } from "./triage.ts";

const EMPTY_CONTEXT: ProjectContext = {
  directoryTree: "",
  packageFiles: [],
  ciConfigs: [],
  toolConfigs: [],
  shellScripts: [],
  lockfiles: [],
};

describe("PROMPT_ANCHORS enforcement", () => {
  test("assess anchor matches runAssessStage prompt opening", async () => {
    let capturedPrompt = "";
    const ctx = {
      agent: "test-agent",
      folder: "/test/project",
      config: { models: { assess: "opus" }, readOnlyTools: "Read Glob Grep" } as never,
      claude: async (args: string[]) => {
        const idx = args.indexOf("-p");
        capturedPrompt = idx >= 0 ? (args[idx + 1] ?? "") : "";
        return "";
      },
      onProgress: () => {},
    };
    await runAssessStage(ctx as never).catch(() => {});
    expect(capturedPrompt).toBeTruthy();
    expect(capturedPrompt.startsWith(PROMPT_ANCHORS.assess)).toBe(true);
  });

  test("name anchor matches runNameStage prompt opening", async () => {
    let capturedPrompt = "";
    const ctx = {
      agent: "test-agent",
      folder: "/test/project",
      config: { models: { name: "haiku" }, readOnlyTools: "Read Glob Grep" } as never,
      claude: async (args: string[]) => {
        const idx = args.indexOf("-p");
        capturedPrompt = idx >= 0 ? (args[idx + 1] ?? "") : "";
        return "";
      },
      onProgress: () => {},
    };
    await runNameStage(ctx as never, "some assessment").catch(() => {});
    expect(capturedPrompt).toBeTruthy();
    expect(capturedPrompt.startsWith(PROMPT_ANCHORS.name)).toBe(true);
  });

  test("plan anchor matches runPlanStage prompt opening", async () => {
    let capturedPrompt = "";
    const ctx = {
      agent: "test-agent",
      folder: "/test/project",
      config: { models: { plan: "opus" }, readOnlyTools: "Read Glob Grep" } as never,
      claude: async (args: string[]) => {
        const idx = args.indexOf("-p");
        capturedPrompt = idx >= 0 ? (args[idx + 1] ?? "") : "";
        return "";
      },
      onProgress: () => {},
    };
    await runPlanStage(ctx as never, "some assessment").catch(() => {});
    expect(capturedPrompt).toBeTruthy();
    expect(capturedPrompt.startsWith(PROMPT_ANCHORS.plan)).toBe(true);
  });

  test("execute anchor matches buildExecutePrompt opening", () => {
    const prompt = buildExecutePrompt("/test/project", "assessment text", "plan text");
    expect(prompt.startsWith(PROMPT_ANCHORS.execute)).toBe(true);
  });

  test("buildExecutePrompt embeds RECURSION_GUARD", () => {
    const prompt = buildExecutePrompt("/test/project", "assessment text", "plan text");
    expect(prompt.includes(RECURSION_GUARD)).toBe(true);
  });

  test("buildMaintainPrompt embeds RECURSION_GUARD", () => {
    const prompt = buildMaintainPrompt("/test/project", []);
    expect(prompt.includes(RECURSION_GUARD)).toBe(true);
  });

  test("triage anchor matches buildTriagePrompt opening", () => {
    const prompt = buildTriagePrompt("assessment text", "some-principle");
    expect(prompt.startsWith(PROMPT_ANCHORS.triage)).toBe(true);
  });

  test("summarize anchor matches buildIterateSummarizePrompt opening", () => {
    const prompt = buildIterateSummarizePrompt({
      name: "fix-something",
      structuredAssessment: {
        severity: 3,
        principle: "some-principle",
        category: "architecture",
        prose: "",
        raw: "",
      },
      triageResult: { accepted: true, reason: "", severity: 3, changeType: "architecture", busyWork: false },
      execution: "did some work",
      retries: 0,
      gatesResult: null,
    });
    expect(prompt.startsWith(PROMPT_ANCHORS.summarize)).toBe(true);
  });

  test("summarize anchor matches buildMaintainSummarizePrompt opening", () => {
    const prompt = buildMaintainSummarizePrompt({
      name: "dep-update",
      execution: "updated deps",
      retries: 0,
      gatesResult: null,
    });
    expect(prompt.startsWith(PROMPT_ANCHORS.summarize)).toBe(true);
  });

  test("derive anchor matches buildDerivePrompt opening", () => {
    const prompt = buildDerivePrompt("/test/project", EMPTY_CONTEXT);
    expect(prompt.startsWith(PROMPT_ANCHORS.derive)).toBe(true);
  });

  test("deriveGates anchor matches buildDeriveGatesPrompt opening", () => {
    const prompt = buildDeriveGatesPrompt("/test/project", EMPTY_CONTEXT);
    expect(prompt.startsWith(PROMPT_ANCHORS.deriveGates)).toBe(true);
  });

  test("mixPrinciples anchor matches buildPrinciplesMixPrompt opening", () => {
    const prompt = buildPrinciplesMixPrompt("foreign content", "/path/to/agent.md");
    expect(prompt.startsWith(PROMPT_ANCHORS.mixPrinciples)).toBe(true);
  });

  test("mixGates anchor matches buildGatesMixPrompt opening", () => {
    const prompt = buildGatesMixPrompt("foreign content", "/path/to/agent.md");
    expect(prompt.startsWith(PROMPT_ANCHORS.mixGates)).toBe(true);
  });
});
