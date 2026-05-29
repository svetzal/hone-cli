import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProposalProgress } from "./pipeline.ts";
import {
  buildExecutePrompt,
  buildRetryPrompt,
  runAssessStage,
  runNameStage,
  runPlanStage,
  runProposalPipeline,
  sanitizeName,
} from "./pipeline.ts";
import {
  acceptingTriageRunner,
  createIterateMock,
  extractPrompt,
  makeCtx,
  rejectingBusyWorkTriageRunner,
} from "./test-helpers.ts";
import type { ClaudeInvoker } from "./types.ts";

function makeProgress(): ProposalProgress {
  return {
    onAssess: () => {},
    onAssessSaved: () => {},
    onName: () => {},
    onTriageStart: () => {},
    onTriageAccepted: () => {},
    onTriageRejected: () => {},
  };
}

describe("buildExecutePrompt", () => {
  test("starts with the role-clarification line", () => {
    const prompt = buildExecutePrompt("/my/project", "assessment text", "plan text");
    const firstLine = prompt.split("\n")[0];
    expect(firstLine).toBe("You are running inside a hone iterate run for the project at /my/project.");
  });

  test("contains do-not-invoke hone iterate instruction", () => {
    const prompt = buildExecutePrompt("/my/project", "assessment text", "plan text");
    expect(prompt).toContain("do not invoke `hone iterate`");
  });

  test("contains do-not-invoke hone maintain instruction", () => {
    const prompt = buildExecutePrompt("/my/project", "assessment text", "plan text");
    expect(prompt).toContain("`hone maintain`");
  });

  test("contains the assessment", () => {
    const prompt = buildExecutePrompt("/my/project", "assessment text", "plan text");
    expect(prompt).toContain("assessment text");
  });

  test("contains the plan", () => {
    const prompt = buildExecutePrompt("/my/project", "assessment text", "plan text");
    expect(prompt).toContain("plan text");
  });

  test("contains the folder path in the execute instruction", () => {
    const prompt = buildExecutePrompt("/specific/folder", "assessment", "plan");
    expect(prompt).toContain("/specific/folder");
  });
});

describe("sanitizeName", () => {
  test("extracts kebab-case name from clean LLM output", () => {
    expect(sanitizeName("fix-broken-auth-handler")).toBe("fix-broken-auth-handler");
  });

  test("extracts from output with surrounding markdown backticks", () => {
    expect(sanitizeName("`improve-error-handling`")).toBe("improve-error-handling");
  });

  test("caps at 50 characters", () => {
    const longName = "a".repeat(60);
    expect(sanitizeName(longName)).toBe("a".repeat(50));
  });

  test("returns empty string when no alphanumeric content", () => {
    expect(sanitizeName("!!!---!!!")).toBe("");
    expect(sanitizeName("")).toBe("");
  });

  test("extracts kebab-case name from surrounding prose", () => {
    expect(sanitizeName("The name is fix-auth")).toBe("fix-auth");
  });

  test("handles trailing newline", () => {
    expect(sanitizeName("fix-auth-bug\n")).toBe("fix-auth-bug");
  });

  test("lowercases input to handle mixed-case LLM output", () => {
    expect(sanitizeName("Fix-Broken-Auth")).toBe("fix-broken-auth");
    expect(sanitizeName("ALLCAPS")).toBe("allcaps");
  });

  test("prefers longest multi-segment kebab match", () => {
    expect(sanitizeName("Try fix-auth or fix-broken-auth-handler")).toBe("fix-broken-auth-handler");
  });

  test("falls back to single word when no kebab segments found", () => {
    expect(sanitizeName("refactor")).toBe("refactor");
  });
});

describe("buildRetryPrompt", () => {
  test("includes original plan and failed gate output", () => {
    const prompt = buildRetryPrompt(
      "/my/project",
      "Step 1: Fix the thing",
      "Assessment content",
      [{ name: "test", output: "FAIL: expected 1 got 2" }],
      [],
    );

    expect(prompt).toContain("## Original Plan");
    expect(prompt).toContain("Step 1: Fix the thing");
    expect(prompt).toContain("## Current Failed Gates");
    expect(prompt).toContain("### Gate: test");
    expect(prompt).toContain("FAIL: expected 1 got 2");
  });

  test("formats multiple failed gates", () => {
    const prompt = buildRetryPrompt(
      "/my/project",
      "Plan content",
      "Assessment content",
      [
        { name: "test", output: "test failure" },
        { name: "lint", output: "lint failure" },
      ],
      [],
    );

    expect(prompt).toContain("### Gate: test");
    expect(prompt).toContain("test failure");
    expect(prompt).toContain("### Gate: lint");
    expect(prompt).toContain("lint failure");
  });

  test("includes instruction to not regress", () => {
    const prompt = buildRetryPrompt("/my/project", "Plan", "Assessment", [{ name: "test", output: "fail" }], []);
    expect(prompt).toContain("Fix the failures below WITHOUT regressing");
  });

  test("includes goal section with folder and assessment", () => {
    const prompt = buildRetryPrompt(
      "/my/project",
      "Plan",
      "Assessment content here",
      [{ name: "test", output: "fail" }],
      [],
    );
    expect(prompt).toContain("## Goal");
    expect(prompt).toContain("/my/project");
    expect(prompt).toContain("## Assessment");
    expect(prompt).toContain("Assessment content here");
  });

  test("includes cumulative prior attempt history", () => {
    const prompt = buildRetryPrompt(
      "/my/project",
      "Plan",
      "Assessment",
      [{ name: "test", output: "FAIL: attempt 3 error" }],
      [
        { attempt: 1, failedGates: [{ name: "test", output: "FAIL: attempt 1 error" }] },
        { attempt: 2, failedGates: [{ name: "test", output: "FAIL: attempt 2 error" }] },
      ],
    );

    expect(prompt).toContain("## Attempt 1");
    expect(prompt).toContain("FAIL: attempt 1 error");
    expect(prompt).toContain("## Attempt 2");
    expect(prompt).toContain("FAIL: attempt 2 error");
    expect(prompt).toContain("## Current Failed Gates");
    expect(prompt).toContain("FAIL: attempt 3 error");
  });
});

describe("runAssessStage", () => {
  test("returns value from the invoker", async () => {
    const mockClaude: ClaudeInvoker = async () => "canned assessment";
    const ctx = makeCtx({ folder: "/test/project", claude: mockClaude });
    const result = await runAssessStage(ctx);
    expect(result).toBe("canned assessment");
  });

  test("prompt contains 'Assess the project' and the folder path", async () => {
    let captured: string[] = [];
    const mockClaude: ClaudeInvoker = async (args) => {
      captured = args;
      return "assessment";
    };
    const ctx = makeCtx({ folder: "/test/project", claude: mockClaude });
    await runAssessStage(ctx);
    const prompt = extractPrompt(captured);
    expect(prompt).toContain("Assess the project");
    expect(prompt).toContain("/test/project");
  });

  test("prompt contains severity JSON schema instruction", async () => {
    let captured: string[] = [];
    const mockClaude: ClaudeInvoker = async (args) => {
      captured = args;
      return "assessment";
    };
    const ctx = makeCtx({ folder: "/test/project", claude: mockClaude });
    await runAssessStage(ctx);
    const prompt = extractPrompt(captured);
    expect(prompt).toContain('"severity"');
  });

  test("args include the agent name", async () => {
    let captured: string[] = [];
    const mockClaude: ClaudeInvoker = async (args) => {
      captured = args;
      return "assessment";
    };
    const ctx = makeCtx({ folder: "/test/project", claude: mockClaude });
    await runAssessStage(ctx);
    expect(captured).toEqual(expect.arrayContaining(["--agent", "test-agent"]));
  });
});

describe("runNameStage", () => {
  test("returns sanitized kebab-case from clean invoker response", async () => {
    const mockClaude: ClaudeInvoker = async () => "fix-broken-auth-handler";
    const ctx = makeCtx({ folder: "/test/project", claude: mockClaude });
    const result = await runNameStage(ctx, "some assessment");
    expect(result).toBe("fix-broken-auth-handler");
  });

  test("falls back to assessment-<timestamp> when response cannot be sanitized", async () => {
    const mockClaude: ClaudeInvoker = async () => "!!!";
    const ctx = makeCtx({ folder: "/test/project", claude: mockClaude });
    const result = await runNameStage(ctx, "some assessment");
    expect(result.startsWith("assessment-")).toBe(true);
    const suffix = result.slice("assessment-".length);
    expect(Number.isFinite(Number(suffix))).toBe(true);
  });

  test("prompt contains 'Output ONLY' and the assessment text", async () => {
    let captured: string[] = [];
    const mockClaude: ClaudeInvoker = async (args) => {
      captured = args;
      return "fix-auth";
    };
    const ctx = makeCtx({ folder: "/test/project", claude: mockClaude });
    await runNameStage(ctx, "The project has auth issues");
    const prompt = extractPrompt(captured);
    expect(prompt).toContain("Output ONLY");
    expect(prompt).toContain("The project has auth issues");
  });
});

describe("runPlanStage", () => {
  test("returns plan from the invoker", async () => {
    const mockClaude: ClaudeInvoker = async () => "Step 1: Fix\nStep 2: Done";
    const ctx = makeCtx({ folder: "/test/project", claude: mockClaude });
    const result = await runPlanStage(ctx, "assessment text");
    expect(result).toBe("Step 1: Fix\nStep 2: Done");
  });

  test("prompt contains 'Based on the following assessment' and the assessment text", async () => {
    let captured: string[] = [];
    const mockClaude: ClaudeInvoker = async (args) => {
      captured = args;
      return "plan";
    };
    const ctx = makeCtx({ folder: "/test/project", claude: mockClaude });
    await runPlanStage(ctx, "the assessment content");
    const prompt = extractPrompt(captured);
    expect(prompt).toContain("Based on the following assessment");
    expect(prompt).toContain("the assessment content");
  });

  test("prompt contains CRITICAL RULES section", async () => {
    let captured: string[] = [];
    const mockClaude: ClaudeInvoker = async (args) => {
      captured = args;
      return "plan";
    };
    const ctx = makeCtx({ folder: "/test/project", claude: mockClaude });
    await runPlanStage(ctx, "assessment");
    const prompt = extractPrompt(captured);
    expect(prompt).toContain("CRITICAL RULES");
  });
});

describe("runProposalPipeline", () => {
  test("happy path with skipTriage returns name, assessment, and null triageResult", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-pipe-"));
    try {
      const mockClaude = createIterateMock({
        assess: "The project violates SRP.",
        name: "fix-srp-violation",
        plan: "",
        execute: "",
      });
      const ctx = makeCtx({ folder: dir, claude: mockClaude });
      const result = await runProposalPipeline(ctx, dir, {
        skipTriage: true,
        triageRunner: acceptingTriageRunner,
        progress: makeProgress(),
      });
      expect(result.rejected).toBe(false);
      if (!result.rejected) {
        expect(result.name).toBe("fix-srp-violation");
        expect(result.assessment).toBe("The project violates SRP.");
        expect(result.triageResult).toBeNull();
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("happy path with triage accepted populates triageResult", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-pipe-"));
    try {
      const mockClaude = createIterateMock({
        assess: "The project violates SRP.",
        name: "fix-srp-violation",
        plan: "",
        execute: "",
      });
      const ctx = makeCtx({ folder: dir, claude: mockClaude });
      const result = await runProposalPipeline(ctx, dir, {
        skipTriage: false,
        triageRunner: acceptingTriageRunner,
        progress: makeProgress(),
      });
      expect(result.rejected).toBe(false);
      if (!result.rejected) {
        expect(result.triageResult).not.toBeNull();
        expect(result.triageResult?.accepted).toBe(true);
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("triage rejected returns rejected: true with busyWork flag", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-pipe-"));
    try {
      const mockClaude = createIterateMock({
        assess: "The project violates SRP.",
        name: "fix-srp-violation",
        plan: "",
        execute: "",
      });
      const ctx = makeCtx({ folder: dir, claude: mockClaude });
      const result = await runProposalPipeline(ctx, dir, {
        skipTriage: false,
        triageRunner: rejectingBusyWorkTriageRunner,
        progress: makeProgress(),
      });
      expect(result.rejected).toBe(true);
      if (result.rejected) {
        expect(result.triageResult?.busyWork).toBe(true);
        expect(result.reason).toContain("Busy-work");
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("progress callbacks are invoked in expected order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-pipe-"));
    try {
      const mockClaude = createIterateMock({
        assess: "Assessment.",
        name: "fix-something",
        plan: "",
        execute: "",
      });
      const ctx = makeCtx({ folder: dir, claude: mockClaude });
      const order: string[] = [];
      const progress: ProposalProgress = {
        onAssess: () => {
          order.push("assess");
        },
        onAssessSaved: () => {
          order.push("assessSaved");
        },
        onName: () => {
          order.push("name");
        },
        onTriageStart: () => {
          order.push("triageStart");
        },
        onTriageAccepted: () => {
          order.push("triageAccepted");
        },
        onTriageRejected: () => {
          order.push("triageRejected");
        },
      };
      await runProposalPipeline(ctx, dir, {
        skipTriage: true,
        triageRunner: acceptingTriageRunner,
        progress,
      });
      expect(order).toContain("assess");
      expect(order).toContain("name");
      expect(order).toContain("assessSaved");
      expect(order.indexOf("assess")).toBeLessThan(order.indexOf("name"));
      expect(order.indexOf("name")).toBeLessThan(order.indexOf("assessSaved"));
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("creates assessment audit file in auditDir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-pipe-"));
    try {
      const mockClaude = createIterateMock({
        assess: "Assessment text.",
        name: "fix-srp",
        plan: "",
        execute: "",
      });
      const ctx = makeCtx({ folder: dir, claude: mockClaude });
      await runProposalPipeline(ctx, dir, {
        skipTriage: true,
        triageRunner: acceptingTriageRunner,
        progress: makeProgress(),
      });
      expect(existsSync(join(dir, "fix-srp.md"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
