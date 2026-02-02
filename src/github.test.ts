import { describe, expect, test } from "bun:test";
import {
  getRepoOwner,
  ensureHoneLabel,
  listHoneIssues,
  getIssueReactions,
  createHoneIssue,
  closeIssueWithComment,
  formatIssueBody,
  parseIssueBody,
  getLatestCommitHash,
  gitCommit,
} from "./github.ts";
import type { CommandRunner } from "./types.ts";

function mockRunner(responses: Map<string, { stdout: string; exitCode: number }>): CommandRunner {
  return async (command, args) => {
    const key = `${command} ${args.join(" ")}`;
    for (const [pattern, response] of responses) {
      if (key.includes(pattern)) return response;
    }
    return { stdout: "", exitCode: 1 };
  };
}

describe("getRepoOwner", () => {
  test("parses owner from gh output", async () => {
    const run = mockRunner(
      new Map([["repo view", { stdout: "mojility\n", exitCode: 0 }]]),
    );

    const owner = await getRepoOwner("/project", run);
    expect(owner).toBe("mojility");
  });

  test("throws on failure", async () => {
    const run = mockRunner(
      new Map([["repo view", { stdout: "error", exitCode: 1 }]]),
    );

    expect(getRepoOwner("/project", run)).rejects.toThrow("Failed to get repo owner");
  });
});

describe("ensureHoneLabel", () => {
  test("succeeds when label is created", async () => {
    const run = mockRunner(
      new Map([["label create", { stdout: "", exitCode: 0 }]]),
    );

    // Should not throw
    await ensureHoneLabel("/project", run);
  });

  test("succeeds silently when label already exists", async () => {
    const run = mockRunner(
      new Map([["label create", { stdout: "already exists", exitCode: 1 }]]),
    );

    // Should not throw even on failure (label already exists)
    await ensureHoneLabel("/project", run);
  });
});

describe("listHoneIssues", () => {
  test("parses issue list from gh output", async () => {
    const issues = JSON.stringify([
      { number: 1, title: "Fix SRP", body: "body1", createdAt: "2024-01-01T00:00:00Z" },
      { number: 2, title: "Add tests", body: "body2", createdAt: "2024-01-02T00:00:00Z" },
    ]);

    const run = mockRunner(
      new Map([["issue list", { stdout: issues, exitCode: 0 }]]),
    );

    const result = await listHoneIssues("/project", run);
    expect(result).toHaveLength(2);
    expect(result[0]!.number).toBe(1);
    expect(result[0]!.title).toBe("Fix SRP");
    expect(result[1]!.number).toBe(2);
  });

  test("returns empty array on empty output", async () => {
    const run = mockRunner(
      new Map([["issue list", { stdout: "[]", exitCode: 0 }]]),
    );

    const result = await listHoneIssues("/project", run);
    expect(result).toHaveLength(0);
  });
});

describe("getIssueReactions", () => {
  test("parses reactions from API output", async () => {
    const reactions = [
      '{"user":"alice","content":"+1"}',
      '{"user":"bob","content":"-1"}',
      '{"user":"carol","content":"+1"}',
    ].join("\n");

    const run = mockRunner(
      new Map([
        ["repo view", { stdout: "org/repo\n", exitCode: 0 }],
        ["api", { stdout: reactions, exitCode: 0 }],
      ]),
    );

    const result = await getIssueReactions("/project", 1, run);
    expect(result.thumbsUp).toEqual(["alice", "carol"]);
    expect(result.thumbsDown).toEqual(["bob"]);
  });

  test("returns empty on API error", async () => {
    const run = mockRunner(
      new Map([
        ["repo view", { stdout: "org/repo\n", exitCode: 0 }],
        ["api", { stdout: "", exitCode: 1 }],
      ]),
    );

    const result = await getIssueReactions("/project", 1, run);
    expect(result.thumbsUp).toEqual([]);
    expect(result.thumbsDown).toEqual([]);
  });
});

describe("createHoneIssue", () => {
  test("parses issue number from URL", async () => {
    const run = mockRunner(
      new Map([["issue create", { stdout: "https://github.com/org/repo/issues/42\n", exitCode: 0 }]]),
    );

    const num = await createHoneIssue("/project", "Fix SRP", "body", run);
    expect(num).toBe(42);
  });

  test("throws on failure", async () => {
    const run = mockRunner(
      new Map([["issue create", { stdout: "error", exitCode: 1 }]]),
    );

    expect(createHoneIssue("/project", "title", "body", run)).rejects.toThrow("Failed to create issue");
  });
});

describe("closeIssueWithComment", () => {
  test("calls gh issue close with comment", async () => {
    const capturedArgs: string[][] = [];
    const run: CommandRunner = async (cmd, args) => {
      capturedArgs.push([cmd, ...args]);
      return { stdout: "", exitCode: 0 };
    };

    await closeIssueWithComment("/project", 42, "Completed", run);
    expect(capturedArgs[0]).toContain("42");
    expect(capturedArgs[0]).toContain("--comment");
    expect(capturedArgs[0]).toContain("Completed");
  });
});

describe("formatIssueBody / parseIssueBody", () => {
  test("round-trip: format then parse", () => {
    const proposal = {
      assessment: "The code violates SRP.",
      plan: "Step 1: Extract class\nStep 2: Move methods",
      agent: "typescript-craftsperson",
      severity: 4,
      principle: "Single Responsibility",
    };

    const body = formatIssueBody(proposal);
    const parsed = parseIssueBody(body);

    expect(parsed).not.toBeNull();
    expect(parsed!.agent).toBe("typescript-craftsperson");
    expect(parsed!.severity).toBe(4);
    expect(parsed!.principle).toBe("Single Responsibility");
    expect(parsed!.assessment).toBe("The code violates SRP.");
    expect(parsed!.plan).toBe("Step 1: Extract class\nStep 2: Move methods");
  });

  test("parseIssueBody returns null for non-hone body", () => {
    const result = parseIssueBody("This is a regular issue body without metadata.");
    expect(result).toBeNull();
  });

  test("parseIssueBody returns null for malformed metadata", () => {
    const result = parseIssueBody("<!-- hone-metadata\ninvalid json\n-->");
    expect(result).toBeNull();
  });
});

describe("getLatestCommitHash", () => {
  test("returns trimmed hash", async () => {
    const run = mockRunner(
      new Map([["rev-parse", { stdout: "abc123def456\n", exitCode: 0 }]]),
    );

    const hash = await getLatestCommitHash("/project", run);
    expect(hash).toBe("abc123def456");
  });
});

describe("gitCommit", () => {
  test("stages, commits, and returns hash", async () => {
    const capturedCalls: string[] = [];
    const run: CommandRunner = async (cmd, args) => {
      const key = `${cmd} ${args.join(" ")}`;
      capturedCalls.push(key);
      if (key.includes("rev-parse")) return { stdout: "newcommithash\n", exitCode: 0 };
      return { stdout: "", exitCode: 0 };
    };

    const hash = await gitCommit("/project", "test commit", run);
    expect(hash).toBe("newcommithash");
    expect(capturedCalls[0]).toContain("add -A");
    expect(capturedCalls[1]).toContain("commit -m");
    expect(capturedCalls[1]).toContain("test commit");
  });

  test("throws when git add fails", async () => {
    const run: CommandRunner = async () => ({ stdout: "error", exitCode: 1 });

    expect(gitCommit("/project", "msg", run)).rejects.toThrow("git add failed");
  });
});
