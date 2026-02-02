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
});
