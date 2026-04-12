import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listIterations, resolveAuditDir } from "./audit.ts";

describe("resolveAuditDir", () => {
  test("joins relative path with project dir", () => {
    expect(resolveAuditDir("/home/user/project", "audit")).toBe("/home/user/project/audit");
  });

  test("uses absolute path directly, ignoring project dir", () => {
    expect(resolveAuditDir("/home/user/project", "/tmp/hone-audits")).toBe("/tmp/hone-audits");
  });
});

describe("listIterations", () => {
  test("groups related audit files by base name", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      await writeFile(join(dir, "fix-auth-bug.md"), "assessment");
      await writeFile(join(dir, "fix-auth-bug-plan.md"), "plan");
      await writeFile(join(dir, "fix-auth-bug-actions.md"), "actions");
      await writeFile(join(dir, "improve-logging.md"), "assessment");
      await writeFile(join(dir, "improve-logging-plan.md"), "plan");

      const entries = await listIterations(dir);

      expect(entries.length).toBe(2);

      const fixAuthEntry = entries.find((e) => e.name === "fix-auth-bug");
      expect(fixAuthEntry).toBeDefined();
      expect(fixAuthEntry?.files.length).toBe(3);

      const improveLoggingEntry = entries.find((e) => e.name === "improve-logging");
      expect(improveLoggingEntry).toBeDefined();
      expect(improveLoggingEntry?.files.length).toBe(2);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("groups retry action files correctly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      await writeFile(join(dir, "fix-auth-bug.md"), "assessment");
      await writeFile(join(dir, "fix-auth-bug-plan.md"), "plan");
      await writeFile(join(dir, "fix-auth-bug-actions.md"), "actions");
      await writeFile(join(dir, "fix-auth-bug-retry-1-actions.md"), "retry 1");
      await writeFile(join(dir, "fix-auth-bug-retry-2-actions.md"), "retry 2");

      const entries = await listIterations(dir);

      expect(entries.length).toBe(1);
      expect(entries[0]?.name).toBe("fix-auth-bug");
      expect(entries[0]?.files.length).toBe(5);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("sorts entries newest-first by file modification time", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      // Write first file
      await writeFile(join(dir, "older-issue.md"), "old");

      // Wait a bit to ensure different mtime
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Write second file
      await writeFile(join(dir, "newer-issue.md"), "new");

      const entries = await listIterations(dir);

      expect(entries.length).toBe(2);
      // Newer should be first
      expect(entries[0]?.name).toBe("newer-issue");
      expect(entries[1]?.name).toBe("older-issue");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("returns empty array for non-existent directory", async () => {
    const nonExistentDir = `/tmp/nonexistent-dir-${Date.now()}`;
    const entries = await listIterations(nonExistentDir);
    expect(entries).toEqual([]);
  });

  test("returns empty array for directory with no .md files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      await writeFile(join(dir, "test.txt"), "not a markdown file");

      const entries = await listIterations(dir);
      expect(entries).toEqual([]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
