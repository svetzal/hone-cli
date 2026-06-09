import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcess } from "./process";

describe("runProcess", () => {
  it("should capture stdout, stderr, and exit code 0 for successful command", async () => {
    const result = await runProcess(["echo", "hello world"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello world");
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
  });

  it("should capture non-zero exit code for failed command", async () => {
    const result = await runProcess(["sh", "-c", "exit 42"]);

    expect(result.exitCode).toBe(42);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("should capture stderr from command", async () => {
    const result = await runProcess(["sh", "-c", "echo error message >&2 && exit 1"]);

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
    expect(result.timedOut).toBe(true);
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
    const result = await runProcess(["sh", "-c", "echo stdout && echo stderr >&2"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("stdout");
    expect(result.stderr.trim()).toBe("stderr");
  });

  it("should pass env option through to the subprocess", async () => {
    const result = await runProcess(["sh", "-c", "echo $MY_VAR"], {
      env: { ...process.env, MY_VAR: "hello" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
  });

  it("should not deadlock when stderr exceeds the pipe buffer while stdout is open", async () => {
    // ~200KB to stderr (well past the ~64KB OS pipe buffer), then a line to stdout
    const result = await runProcess(["sh", "-c", "yes 0123456789 | head -c 200000 >&2; echo done"], { timeout: 5000 });

    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("done");
    expect(result.stderr.length).toBeGreaterThanOrEqual(200000);
  });
});
