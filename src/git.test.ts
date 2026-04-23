import { describe, expect, test } from "bun:test";
import { getLatestCommitHash, gitCommit } from "./git.ts";
import type { CommandRunner } from "./types.ts";

describe("getLatestCommitHash", () => {
  test("returns trimmed hash", async () => {
    const run: CommandRunner = async (cmd, args) => {
      const key = `${cmd} ${args.join(" ")}`;
      if (key.includes("rev-parse")) return { stdout: "abc123def456\n", exitCode: 0 };
      return { stdout: "", exitCode: 1 };
    };

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
