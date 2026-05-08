import { describe, expect, test } from "bun:test";
import { CliError, SilentExitError } from "./errors.ts";

describe("SilentExitError", () => {
  test("is an instance of CliError", () => {
    const err = new SilentExitError();
    expect(err).toBeInstanceOf(CliError);
    expect(err.message).toBe("");
    expect(err.name).toBe("SilentExitError");
  });

  test("CliError with message is not a SilentExitError", () => {
    const err = new CliError("something went wrong");
    expect(err).not.toBeInstanceOf(SilentExitError);
    expect(err.message).toBe("something went wrong");
  });
});

// Test parseArgs by importing the module and testing the CLI behavior
// Since parseArgs is not exported, we test via CLI execution

describe("CLI", () => {
  test("--help prints usage", async () => {
    const proc = Bun.spawn([process.execPath, "run", "src/cli.ts", "--help"], {
      cwd: `${import.meta.dir}/..`,
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
    const proc = Bun.spawn([process.execPath, "run", "src/cli.ts", "--version"], {
      cwd: `${import.meta.dir}/..`,
      stdout: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;

    expect(output.trim()).toMatch(/^hone v\d+\.\d+\.\d+$/);
  });

  test("init --help prints init usage", async () => {
    const proc = Bun.spawn([process.execPath, "run", "src/cli.ts", "init", "--help"], {
      cwd: `${import.meta.dir}/..`,
      stdout: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(output).toContain("Usage: hone init");
    expect(output).toContain("--global");
    expect(output).toContain("--force");
  });

  test("unknown command exits with error", async () => {
    const proc = Bun.spawn([process.execPath, "run", "src/cli.ts", "nonexistent"], {
      cwd: `${import.meta.dir}/..`,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;

    expect(exitCode).not.toBe(0);
  });
});
