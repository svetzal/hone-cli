import { describe, it, expect } from "bun:test";
import { runProcess } from "./process";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("runProcess", () => {
  it("should capture stdout, stderr, and exit code 0 for successful command", async () => {
    const result = await runProcess(["echo", "hello world"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello world");
    expect(result.stderr).toBe("");
  });

  it("should capture non-zero exit code for failed command", async () => {
    const result = await runProcess(["sh", "-c", "exit 42"]);

    expect(result.exitCode).toBe(42);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("should capture stderr from command", async () => {
    const result = await runProcess([
      "sh",
      "-c",
      "echo error message >&2 && exit 1",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe("error message");
  });

  it("should kill process after timeout", async () => {
    const start = Date.now();
    const result = await runProcess(["sleep", "10"], { timeout: 100 });
    const duration = Date.now() - start;

    // Process should be killed within ~100ms, not run for 10 seconds
    expect(duration).toBeLessThan(1000);
    expect(result.exitCode).not.toBe(0);
  });

  it("should respect cwd option", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hone-test-"));
    const testFile = join(tempDir, "test.txt");
    writeFileSync(testFile, "test content");

    const result = await runProcess(["ls", "test.txt"], { cwd: tempDir });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("test.txt");
  });

  it("should capture both stdout and stderr", async () => {
    const result = await runProcess([
      "sh",
      "-c",
      "echo stdout && echo stderr >&2",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("stdout");
    expect(result.stderr.trim()).toBe("stderr");
  });
});
