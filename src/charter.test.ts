import { describe, expect, test } from "bun:test";
import { checkCharter } from "./charter.ts";
import { join } from "path";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";

describe("checkCharter", () => {
  test("fails with guidance when no files exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-charter-"));
    try {
      const result = await checkCharter(dir, 100);

      expect(result.passed).toBe(false);
      expect(result.sources).toHaveLength(0);
      expect(result.guidance.length).toBeGreaterThan(0);
      expect(result.guidance.some((g) => g.includes("CHARTER.md"))).toBe(true);
      expect(result.guidance.some((g) => g.includes("README.md"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("fails when README is below threshold", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-charter-"));
    try {
      await writeFile(join(dir, "README.md"), "Short readme.");

      const result = await checkCharter(dir, 100);

      expect(result.passed).toBe(false);
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]!.file).toBe("README.md");
      expect(result.sources[0]!.sufficient).toBe(false);
      expect(result.guidance.some((g) => g.includes("too short"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("passes when README is above threshold", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-charter-"));
    try {
      await writeFile(join(dir, "README.md"), "A".repeat(150));

      const result = await checkCharter(dir, 100);

      expect(result.passed).toBe(true);
      expect(result.sources.some((s) => s.file === "README.md" && s.sufficient)).toBe(true);
      expect(result.guidance).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("passes when CHARTER.md has content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-charter-"));
    try {
      await writeFile(join(dir, "CHARTER.md"), "This project aims to " + "x".repeat(100));

      const result = await checkCharter(dir, 100);

      expect(result.passed).toBe(true);
      expect(result.sources.some((s) => s.file === "CHARTER.md" && s.sufficient)).toBe(true);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("passes when CLAUDE.md has Project Charter section", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-charter-"));
    try {
      const content = [
        "# Project",
        "",
        "## Project Charter",
        "",
        "This project is designed to " + "x".repeat(100),
        "",
        "## Other Section",
        "",
        "Something else.",
      ].join("\n");
      await writeFile(join(dir, "CLAUDE.md"), content);

      const result = await checkCharter(dir, 100);

      expect(result.passed).toBe(true);
      expect(result.sources.some((s) => s.file.includes("CLAUDE.md") && s.sufficient)).toBe(true);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("passes when package.json has long enough description", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-charter-"));
    try {
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({ description: "A comprehensive tool for managing " + "x".repeat(100) }),
      );

      const result = await checkCharter(dir, 100);

      expect(result.passed).toBe(true);
      expect(result.sources.some((s) => s.file === "package description" && s.sufficient)).toBe(true);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("custom threshold works", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-charter-"));
    try {
      await writeFile(join(dir, "README.md"), "Short but enough for low threshold.");

      // With high threshold — fail
      const failResult = await checkCharter(dir, 500);
      expect(failResult.passed).toBe(false);

      // With low threshold — pass
      const passResult = await checkCharter(dir, 10);
      expect(passResult.passed).toBe(true);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("collects multiple sources", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-charter-"));
    try {
      await writeFile(join(dir, "CHARTER.md"), "x".repeat(200));
      await writeFile(join(dir, "README.md"), "y".repeat(50));

      const result = await checkCharter(dir, 100);

      expect(result.passed).toBe(true);
      // CHARTER.md sufficient, README.md not sufficient
      expect(result.sources).toHaveLength(2);
      expect(result.sources.find((s) => s.file === "CHARTER.md")!.sufficient).toBe(true);
      expect(result.sources.find((s) => s.file === "README.md")!.sufficient).toBe(false);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
