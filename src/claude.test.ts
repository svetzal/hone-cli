import { describe, expect, test } from "bun:test";
import { buildClaudeArgs } from "./claude.ts";

describe("buildClaudeArgs", () => {
  test("builds read-only args with all flags", () => {
    const args = buildClaudeArgs({
      agent: "typescript-craftsperson",
      model: "opus",
      prompt: "Assess the project",
      readOnly: true,
      readOnlyTools: "Read Glob Grep WebFetch WebSearch",
    });

    expect(args).toEqual([
      "--agent", "typescript-craftsperson",
      "--model", "opus",
      "--print",
      "-p", "Assess the project",
      "--allowedTools", "Read Glob Grep WebFetch WebSearch",
      "--dangerously-skip-permissions",
    ]);
  });

  test("builds write-access args without allowedTools", () => {
    const args = buildClaudeArgs({
      agent: "elixir-craftsperson",
      model: "sonnet",
      prompt: "Execute the plan",
      readOnly: false,
      readOnlyTools: "Read Glob Grep WebFetch WebSearch",
    });

    expect(args).toEqual([
      "--agent", "elixir-craftsperson",
      "--model", "sonnet",
      "--print",
      "-p", "Execute the plan",
      "--dangerously-skip-permissions",
    ]);
  });
});
