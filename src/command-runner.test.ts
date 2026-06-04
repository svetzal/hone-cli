import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandRunner } from "./command-runner.ts";

describe("createCommandRunner", () => {
  const run = createCommandRunner();

  it("should return exitCode 0 and trimmed output for a successful command", async () => {
    const result = await run("echo", ["hello"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello");
  });

  it("should include stderr content in stdout field", async () => {
    const result = await run("sh", ["-c", "echo err >&2"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("err");
  });

  it("should concatenate stdout and stderr", async () => {
    const result = await run("sh", ["-c", "echo out && echo err >&2"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("out");
    expect(result.stdout).toContain("err");
  });

  it("should return non-zero exitCode on failure", async () => {
    const result = await run("sh", ["-c", "exit 3"]);
    expect(result.exitCode).toBe(3);
  });

  it("should honor opts.cwd", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hone-cmd-runner-test-"));
    writeFileSync(join(tempDir, "sentinel.txt"), "");

    const result = await run("ls", ["sentinel.txt"], { cwd: tempDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("sentinel.txt");
  });
});
