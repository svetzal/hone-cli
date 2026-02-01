import { describe, expect, test } from "bun:test";

// Test parseArgs by importing the module and testing the CLI behavior
// Since parseArgs is not exported, we test via CLI execution

describe("CLI", () => {
  test("--help prints usage", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "--help"], {
      cwd: import.meta.dir + "/..",
      stdout: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;

    expect(output).toContain("hone - Iterative codebase quality improvement");
    expect(output).toContain("iterate");
    expect(output).toContain("list-agents");
    expect(output).toContain("gates");
  });

  test("--version prints version", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "--version"], {
      cwd: import.meta.dir + "/..",
      stdout: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;

    expect(output.trim()).toMatch(/^hone v\d+\.\d+\.\d+$/);
  });

  test("unknown command exits with error", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "nonexistent"], {
      cwd: import.meta.dir + "/..",
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;

    expect(exitCode).not.toBe(0);
  });
});
