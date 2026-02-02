import { describe, expect, test } from "bun:test";
import {
  githubIterate,
  closeRejectedIssues,
  executeApprovedIssues,
  proposeImprovements,
} from "./github-iterate.ts";
import { getDefaultConfig } from "./config.ts";
import { formatIssueBody } from "./github.ts";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import type {
  CommandRunner,
  GatesRunResult,
  HoneIssue,
} from "./types.ts";
import { createIterateMock, passingCharterChecker, failingCharterChecker, acceptingTriageRunner, rejectingTriageRunner, emptyGateResolver } from "./test-helpers.ts";

function createMockGhRunner(opts: {
  owner?: string;
  repoName?: string;
  issues?: Array<{
    number: number;
    title: string;
    body: string;
    createdAt: string;
    thumbsUp?: string[];
    thumbsDown?: string[];
  }>;
  createdIssueNumber?: number;
}): { runner: CommandRunner; closedIssues: number[]; createdIssues: Array<{ title: string; body: string }> } {
  const owner = opts.owner ?? "testowner";
  const repoName = opts.repoName ?? "testowner/testrepo";
  const issues = opts.issues ?? [];
  const createdIssueNumber = opts.createdIssueNumber ?? 100;

  const closedIssues: number[] = [];
  const createdIssues: Array<{ title: string; body: string }> = [];
  let createCount = 0;

  const runner: CommandRunner = async (command, args) => {
    const key = `${command} ${args.join(" ")}`;

    // gh repo view --json owner
    if (key.includes("repo view") && key.includes("owner")) {
      return { stdout: `${owner}\n`, exitCode: 0 };
    }

    // gh repo view --json nameWithOwner
    if (key.includes("repo view") && key.includes("nameWithOwner")) {
      return { stdout: `${repoName}\n`, exitCode: 0 };
    }

    // gh issue list
    if (key.includes("issue list")) {
      return {
        stdout: JSON.stringify(issues.map((i) => ({
          number: i.number,
          title: i.title,
          body: i.body,
          createdAt: i.createdAt,
        }))),
        exitCode: 0,
      };
    }

    // gh api reactions
    if (key.includes("api") && key.includes("reactions")) {
      const issueMatch = key.match(/issues\/(\d+)\/reactions/);
      const issueNum = issueMatch ? parseInt(issueMatch[1]!) : -1;
      const issue = issues.find((i) => i.number === issueNum);

      if (!issue) return { stdout: "", exitCode: 0 };

      const lines: string[] = [];
      for (const user of issue.thumbsUp ?? []) {
        lines.push(JSON.stringify({ user, content: "+1" }));
      }
      for (const user of issue.thumbsDown ?? []) {
        lines.push(JSON.stringify({ user, content: "-1" }));
      }
      return { stdout: lines.join("\n"), exitCode: 0 };
    }

    // gh issue close
    if (key.includes("issue close")) {
      const numMatch = key.match(/close (\d+)/);
      if (numMatch) closedIssues.push(parseInt(numMatch[1]!));
      return { stdout: "", exitCode: 0 };
    }

    // gh issue create
    if (key.includes("issue create")) {
      const titleIdx = args.indexOf("--title");
      const bodyIdx = args.indexOf("--body");
      createdIssues.push({
        title: titleIdx >= 0 ? args[titleIdx + 1]! : "",
        body: bodyIdx >= 0 ? args[bodyIdx + 1]! : "",
      });
      createCount++;
      return {
        stdout: `https://github.com/${repoName}/issues/${createdIssueNumber + createCount - 1}\n`,
        exitCode: 0,
      };
    }

    // gh label create (ensure label exists)
    if (key.includes("label create")) return { stdout: "", exitCode: 0 };

    // git add / commit / rev-parse
    if (key.includes("add -A")) return { stdout: "", exitCode: 0 };
    if (key.includes("commit -m")) return { stdout: "", exitCode: 0 };
    if (key.includes("rev-parse")) return { stdout: "abc123\n", exitCode: 0 };

    return { stdout: `Unknown command: ${key}`, exitCode: 1 };
  };

  return { runner, closedIssues, createdIssues };
}

describe("githubIterate", () => {
  test("charter fails → throws error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-gh-"));
    const mockClaude = createIterateMock({
      assess: "x", name: "x", plan: "x", execute: "x",
    });
    const { runner } = createMockGhRunner({});

    try {
      expect(
        githubIterate(
          {
            agent: "test-agent",
            folder: dir,
            config: getDefaultConfig(),
            proposals: 1,
            skipGates: true,
            skipTriage: true,
            charterChecker: failingCharterChecker,
            ghRunner: runner,
            onProgress: () => {},
          },
          mockClaude,
        ),
      ).rejects.toThrow("Charter clarity insufficient");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("thumbs-down issues → closed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-gh-"));
    const mockClaude = createIterateMock({
      assess: "assessment", name: "test-name", plan: "plan", execute: "done",
      triage: '{ "changeType": "architecture", "busyWork": false, "reason": "ok" }',
    });

    const { runner, closedIssues } = createMockGhRunner({
      owner: "testowner",
      issues: [
        {
          number: 5,
          title: "Bad proposal",
          body: formatIssueBody({ assessment: "a", plan: "p", agent: "test", severity: 2, principle: "x" }),
          createdAt: "2024-01-01T00:00:00Z",
          thumbsDown: ["testowner"],
        },
      ],
    });

    try {
      const result = await githubIterate(
        {
          agent: "test-agent",
          folder: dir,
          config: getDefaultConfig(),
          proposals: 0,
          skipGates: true,
          skipTriage: true,
          skipCharter: true,
          ghRunner: runner,
          gateResolver: emptyGateResolver,
          onProgress: () => {},
        },
        mockClaude,
      );

      expect(result.housekeeping.closed).toContain(5);
      expect(closedIssues).toContain(5);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("approved issue → executed, committed, closed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-gh-"));
    const mockClaude = createIterateMock({
      assess: "assessment", name: "test-name", plan: "plan", execute: "done",
    });

    const proposal = {
      assessment: "The code has issues",
      plan: "Step 1: Fix it",
      agent: "test-agent",
      severity: 4,
      principle: "SRP",
    };

    const { runner, closedIssues } = createMockGhRunner({
      owner: "testowner",
      issues: [
        {
          number: 10,
          title: "[Hone] SRP: fix-something",
          body: formatIssueBody(proposal),
          createdAt: "2024-01-01T00:00:00Z",
          thumbsUp: ["testowner"],
        },
      ],
    });

    try {
      const result = await githubIterate(
        {
          agent: "test-agent",
          folder: dir,
          config: getDefaultConfig(),
          proposals: 0,
          skipGates: true,
          skipTriage: true,
          skipCharter: true,
          ghRunner: runner,
          gateResolver: emptyGateResolver,
          onProgress: () => {},
        },
        mockClaude,
      );

      expect(result.executed).toHaveLength(1);
      expect(result.executed[0]!.issueNumber).toBe(10);
      expect(result.executed[0]!.success).toBe(true);
      expect(result.executed[0]!.commitHash).toBe("abc123");
      expect(closedIssues).toContain(10);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("approved issue fails gates → closed with failure comment", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-gh-"));
    const mockClaude = createIterateMock({
      assess: "assessment", name: "test-name", plan: "plan", execute: "done",
    });

    const proposal = {
      assessment: "assessment",
      plan: "plan",
      agent: "test-agent",
      severity: 4,
      principle: "SRP",
    };

    const { runner, closedIssues } = createMockGhRunner({
      owner: "testowner",
      issues: [
        {
          number: 11,
          title: "[Hone] SRP: fix-something",
          body: formatIssueBody(proposal),
          createdAt: "2024-01-01T00:00:00Z",
          thumbsUp: ["testowner"],
        },
      ],
    });

    const failingGateRunner = async (): Promise<GatesRunResult> => ({
      allPassed: false,
      requiredPassed: false,
      results: [{
        name: "test",
        command: "npm test",
        passed: false,
        required: true,
        output: "FAIL: test error",
        exitCode: 1,
      }],
    });

    const config = getDefaultConfig();
    config.maxRetries = 0; // Don't retry

    try {
      const result = await githubIterate(
        {
          agent: "test-agent",
          folder: dir,
          config,
          proposals: 0,
          skipGates: false,
          skipTriage: true,
          skipCharter: true,
          ghRunner: runner,
          gateRunner: failingGateRunner,
          gateResolver: async () => [{ name: "test", command: "npm test", required: true }],
          onProgress: () => {},
        },
        mockClaude,
      );

      expect(result.executed).toHaveLength(1);
      expect(result.executed[0]!.success).toBe(false);
      expect(closedIssues).toContain(11);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("triage rejects proposal → skipped, counter incremented", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-gh-"));
    const mockClaude = createIterateMock({
      assess: "assessment", name: "test-name", plan: "plan", execute: "done",
    });

    const { runner, createdIssues } = createMockGhRunner({ owner: "testowner" });

    try {
      const result = await githubIterate(
        {
          agent: "test-agent",
          folder: dir,
          config: getDefaultConfig(),
          proposals: 1,
          skipGates: true,
          skipTriage: false,
          skipCharter: true,
          ghRunner: runner,
          gateResolver: emptyGateResolver,
          triageRunner: rejectingTriageRunner,
          onProgress: () => {},
        },
        mockClaude,
      );

      expect(result.skippedTriage).toBe(1);
      expect(result.proposed).toHaveLength(0);
      expect(createdIssues).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("--proposals 3 → up to 3 proposals created", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-gh-"));
    const mockClaude = createIterateMock({
      assess: '```json\n{ "severity": 4, "principle": "SRP", "category": "arch" }\n```\nAssessment.',
      name: "fix-something",
      plan: "Plan content",
      execute: "done",
    });

    const { runner, createdIssues } = createMockGhRunner({
      owner: "testowner",
      createdIssueNumber: 50,
    });

    try {
      const result = await githubIterate(
        {
          agent: "test-agent",
          folder: dir,
          config: getDefaultConfig(),
          proposals: 3,
          skipGates: true,
          skipTriage: true,
          skipCharter: true,
          ghRunner: runner,
          gateResolver: emptyGateResolver,
          onProgress: () => {},
        },
        mockClaude,
      );

      expect(result.proposed).toHaveLength(3);
      expect(result.proposed).toEqual([50, 51, 52]);
      expect(createdIssues).toHaveLength(3);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("empty backlog → still proposes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-gh-"));
    const mockClaude = createIterateMock({
      assess: '```json\n{ "severity": 4, "principle": "SRP", "category": "arch" }\n```\nAssessment.',
      name: "fix-something",
      plan: "Plan content",
      execute: "done",
    });

    const { runner, createdIssues } = createMockGhRunner({
      owner: "testowner",
      issues: [], // empty backlog
    });

    try {
      const result = await githubIterate(
        {
          agent: "test-agent",
          folder: dir,
          config: getDefaultConfig(),
          proposals: 1,
          skipGates: true,
          skipTriage: true,
          skipCharter: true,
          ghRunner: runner,
          gateResolver: emptyGateResolver,
          onProgress: () => {},
        },
        mockClaude,
      );

      expect(result.executed).toHaveLength(0);
      expect(result.proposed).toHaveLength(1);
      expect(createdIssues).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe("closeRejectedIssues", () => {
  test("closes thumbs-downed issues and returns their numbers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-close-"));
    const { runner, closedIssues } = createMockGhRunner({
      owner: "testowner",
      issues: [
        {
          number: 1,
          title: "Bad",
          body: "x",
          createdAt: "2024-01-01T00:00:00Z",
          thumbsDown: ["testowner"],
        },
        {
          number: 2,
          title: "Good",
          body: "y",
          createdAt: "2024-01-01T00:00:00Z",
          thumbsUp: ["testowner"],
        },
      ],
    });

    const issues: HoneIssue[] = [
      { number: 1, title: "Bad", body: "x", reactions: { thumbsUp: [], thumbsDown: [] }, createdAt: "2024-01-01T00:00:00Z" },
      { number: 2, title: "Good", body: "y", reactions: { thumbsUp: [], thumbsDown: [] }, createdAt: "2024-01-01T00:00:00Z" },
    ];

    try {
      const closed = await closeRejectedIssues(issues, "testowner", dir, runner, () => {});

      expect(closed).toEqual([1]);
      expect(closedIssues).toEqual([1]);
      expect(issues[1]!.reactions.thumbsUp).toContain("testowner");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("leaves non-rejected issues alone and stores their reactions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-close-"));
    const { runner } = createMockGhRunner({
      owner: "testowner",
      issues: [
        {
          number: 3,
          title: "Neutral",
          body: "z",
          createdAt: "2024-01-01T00:00:00Z",
          thumbsUp: ["otheruser"],
        },
      ],
    });

    const issues: HoneIssue[] = [
      { number: 3, title: "Neutral", body: "z", reactions: { thumbsUp: [], thumbsDown: [] }, createdAt: "2024-01-01T00:00:00Z" },
    ];

    try {
      const closed = await closeRejectedIssues(issues, "testowner", dir, runner, () => {});

      expect(closed).toEqual([]);
      expect(issues[0]!.reactions.thumbsUp).toEqual(["otheruser"]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe("executeApprovedIssues", () => {
  test("successfully executes, commits, and closes an approved issue", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-exec-"));
    const mockClaude = createIterateMock({
      assess: "a", name: "n", plan: "p", execute: "done",
    });

    const proposal = {
      assessment: "The code has issues",
      plan: "Fix it",
      agent: "test-agent",
      severity: 4,
      principle: "SRP",
    };

    const { runner, closedIssues } = createMockGhRunner({ owner: "testowner" });

    const issues: HoneIssue[] = [
      {
        number: 10,
        title: "[Hone] SRP: fix-something",
        body: formatIssueBody(proposal),
        reactions: { thumbsUp: ["testowner"], thumbsDown: [] },
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];

    try {
      const executed = await executeApprovedIssues(
        issues,
        "testowner",
        [],
        dir,
        getDefaultConfig(),
        mockClaude,
        {
          skipGates: true,
          gateRunner: async () => ({ allPassed: true, requiredPassed: true, results: [] }),
          gateResolver: emptyGateResolver,
          ghRunner: runner,
          onProgress: () => {},
        },
      );

      expect(executed).toHaveLength(1);
      expect(executed[0]!.success).toBe(true);
      expect(executed[0]!.commitHash).toBe("abc123");
      expect(closedIssues).toContain(10);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("handles gate failure (closes with failure comment)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-exec-"));
    const mockClaude = createIterateMock({
      assess: "a", name: "n", plan: "p", execute: "done",
    });

    const proposal = {
      assessment: "assessment",
      plan: "plan",
      agent: "test-agent",
      severity: 4,
      principle: "SRP",
    };

    const { runner, closedIssues } = createMockGhRunner({ owner: "testowner" });

    const issues: HoneIssue[] = [
      {
        number: 11,
        title: "[Hone] SRP: fix-something",
        body: formatIssueBody(proposal),
        reactions: { thumbsUp: ["testowner"], thumbsDown: [] },
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];

    const failingGateRunner = async (): Promise<GatesRunResult> => ({
      allPassed: false,
      requiredPassed: false,
      results: [{
        name: "test",
        command: "npm test",
        passed: false,
        required: true,
        output: "FAIL: test error",
        exitCode: 1,
      }],
    });

    const config = getDefaultConfig();
    config.maxRetries = 0;

    try {
      const executed = await executeApprovedIssues(
        issues,
        "testowner",
        [],
        dir,
        config,
        mockClaude,
        {
          skipGates: false,
          gateRunner: failingGateRunner,
          gateResolver: async () => [{ name: "test", command: "npm test", required: true }],
          ghRunner: runner,
          onProgress: () => {},
        },
      );

      expect(executed).toHaveLength(1);
      expect(executed[0]!.success).toBe(false);
      expect(closedIssues).toContain(11);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("skips issues that can't be parsed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-exec-"));
    const mockClaude = createIterateMock({
      assess: "a", name: "n", plan: "p", execute: "done",
    });

    const { runner } = createMockGhRunner({ owner: "testowner" });

    const issues: HoneIssue[] = [
      {
        number: 12,
        title: "[Hone] Invalid",
        body: "this is not a valid proposal body",
        reactions: { thumbsUp: ["testowner"], thumbsDown: [] },
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];

    try {
      const executed = await executeApprovedIssues(
        issues,
        "testowner",
        [],
        dir,
        getDefaultConfig(),
        mockClaude,
        {
          skipGates: true,
          gateRunner: async () => ({ allPassed: true, requiredPassed: true, results: [] }),
          gateResolver: emptyGateResolver,
          ghRunner: runner,
          onProgress: () => {},
        },
      );

      expect(executed).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe("proposeImprovements", () => {
  test("creates the expected number of proposals", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-propose-"));
    const mockClaude = createIterateMock({
      assess: '```json\n{ "severity": 4, "principle": "SRP", "category": "arch" }\n```\nAssessment.',
      name: "fix-something",
      plan: "Plan content",
      execute: "done",
    });

    const { runner, createdIssues } = createMockGhRunner({
      owner: "testowner",
      createdIssueNumber: 100,
    });

    try {
      const { proposed, skippedTriage } = await proposeImprovements(
        "test-agent",
        dir,
        getDefaultConfig(),
        mockClaude,
        {
          proposals: 2,
          skipTriage: true,
          ghRunner: runner,
          triageRunner: acceptingTriageRunner,
          onProgress: () => {},
        },
      );

      expect(proposed).toEqual([100, 101]);
      expect(skippedTriage).toBe(0);
      expect(createdIssues).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("increments skippedTriage when triage rejects", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-propose-"));
    const mockClaude = createIterateMock({
      assess: '```json\n{ "severity": 2, "principle": "Cleanup", "category": "docs" }\n```\nNot substantive.',
      name: "add-comments",
      plan: "Add comments",
      execute: "done",
    });

    const { runner, createdIssues } = createMockGhRunner({ owner: "testowner" });

    try {
      const { proposed, skippedTriage } = await proposeImprovements(
        "test-agent",
        dir,
        getDefaultConfig(),
        mockClaude,
        {
          proposals: 1,
          skipTriage: false,
          ghRunner: runner,
          triageRunner: rejectingTriageRunner,
          onProgress: () => {},
        },
      );

      expect(proposed).toEqual([]);
      expect(skippedTriage).toBe(1);
      expect(createdIssues).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("creates zero issues when all proposals are triaged out", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-propose-"));
    const mockClaude = createIterateMock({
      assess: '```json\n{ "severity": 1, "principle": "Consistency", "category": "style" }\n```\nBusy work.',
      name: "reformat-imports",
      plan: "Reformat imports",
      execute: "done",
    });

    const { runner, createdIssues } = createMockGhRunner({ owner: "testowner" });

    try {
      const { proposed, skippedTriage } = await proposeImprovements(
        "test-agent",
        dir,
        getDefaultConfig(),
        mockClaude,
        {
          proposals: 3,
          skipTriage: false,
          ghRunner: runner,
          triageRunner: rejectingTriageRunner,
          onProgress: () => {},
        },
      );

      expect(proposed).toEqual([]);
      expect(skippedTriage).toBe(3);
      expect(createdIssues).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
