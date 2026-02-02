import { describe, it, expect } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("history command integration", () => {
  const projectRoot = import.meta.dir + "/../..";

  it("should show no history message for empty directory", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "history-test-"));
    try {
      const proc = Bun.spawn(["bun", "run", "src/cli.ts", "history", tempDir], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: projectRoot,
      });
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);
      expect(stdout).toContain("No iteration history found");
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it("should list history when audit directory exists", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "history-test-"));
    try {
      // Create a mock audit entry (audit files are directly in audit/, not in subdirs)
      const auditDir = join(tempDir, "audit");
      await mkdir(auditDir, { recursive: true });
      await writeFile(join(auditDir, "fix-bug.md"), "# Assessment\n\nMock assessment");
      await writeFile(join(auditDir, "fix-bug-plan.md"), "# Plan\n\nMock plan");

      const proc = Bun.spawn(["bun", "run", "src/cli.ts", "history", tempDir], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: projectRoot,
      });
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Iteration history");
      expect(stdout).toContain("fix-bug");
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it("should default to current directory when no folder provided", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "history"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: projectRoot,
    });
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    // Should succeed (either show history or "no history" message)
  });

  it("should output valid JSON array with --json flag", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "history-json-test-"));
    try {
      // Create a mock audit entry
      const auditDir = join(tempDir, "audit");
      await mkdir(auditDir, { recursive: true });
      await writeFile(join(auditDir, "test-iteration.md"), "# Assessment\n\nTest");
      await writeFile(join(auditDir, "test-iteration-plan.md"), "# Plan\n\nTest");

      const proc = Bun.spawn(["bun", "run", "src/cli.ts", "history", tempDir, "--json"], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: projectRoot,
      });
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);

      // Parse as JSON to verify it's valid
      const history = JSON.parse(stdout);

      // Verify it's an array
      expect(Array.isArray(history)).toBe(true);

      // Verify structure of entries
      if (history.length > 0) {
        expect(history[0]).toHaveProperty("name");
        expect(history[0]).toHaveProperty("files");
        expect(history[0]).toHaveProperty("date");
        expect(Array.isArray(history[0].files)).toBe(true);
        // Verify date is ISO string
        expect(() => new Date(history[0].date)).not.toThrow();
      }
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });
});
