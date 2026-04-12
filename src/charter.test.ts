import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCharter } from "./charter.ts";

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
      expect(result.sources[0]?.file).toBe("README.md");
      expect(result.sources[0]?.sufficient).toBe(false);
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
      await writeFile(join(dir, "CHARTER.md"), `This project aims to ${"x".repeat(100)}`);

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
        `This project is designed to ${"x".repeat(100)}`,
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
        JSON.stringify({ description: `A comprehensive tool for managing ${"x".repeat(100)}` }),
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
      expect(result.sources.find((s) => s.file === "CHARTER.md")?.sufficient).toBe(true);
      expect(result.sources.find((s) => s.file === "README.md")?.sufficient).toBe(false);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("warns when CHARTER.md exists but AGENTS.md does not @-reference it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-charter-"));
    try {
      await writeFile(join(dir, "CHARTER.md"), "x".repeat(200));
      await writeFile(join(dir, "AGENTS.md"), "# My Agent\nSome principles.");

      const result = await checkCharter(dir, 100);

      expect(result.passed).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("not @-referenced");
      expect(result.warnings[0]).toContain("AGENTS.md");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("warns when CHARTER.md exists but CLAUDE.md does not @-reference it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-charter-"));
    try {
      await writeFile(join(dir, "CHARTER.md"), "x".repeat(200));
      await writeFile(join(dir, "CLAUDE.md"), "# Project\nSome content.");

      const result = await checkCharter(dir, 100);

      expect(result.passed).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("not @-referenced");
      expect(result.warnings[0]).toContain("CLAUDE.md");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("no warning when AGENTS.md @-references CHARTER.md", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-charter-"));
    try {
      await writeFile(join(dir, "CHARTER.md"), "x".repeat(200));
      await writeFile(join(dir, "AGENTS.md"), "# Agent\n\nSee @CHARTER.md for goals.");

      const result = await checkCharter(dir, 100);

      expect(result.passed).toBe(true);
      expect(result.warnings).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("no warning when CLAUDE.md @-references CHARTER.md", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-charter-"));
    try {
      await writeFile(join(dir, "CHARTER.md"), "x".repeat(200));
      await writeFile(join(dir, "CLAUDE.md"), "# Project\n\n@CHARTER.md");

      const result = await checkCharter(dir, 100);

      expect(result.passed).toBe(true);
      expect(result.warnings).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("no warning when CHARTER.md does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-charter-"));
    try {
      await writeFile(join(dir, "README.md"), "x".repeat(200));

      const result = await checkCharter(dir, 100);

      expect(result.passed).toBe(true);
      expect(result.warnings).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("warns when CHARTER.md exists but no AGENTS.md or CLAUDE.md found", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-charter-"));
    try {
      await writeFile(join(dir, "CHARTER.md"), "x".repeat(200));

      const result = await checkCharter(dir, 100);

      expect(result.passed).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("no AGENTS.md or CLAUDE.md found");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("mentions both files in warning when both exist without @-reference", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-charter-"));
    try {
      await writeFile(join(dir, "CHARTER.md"), "x".repeat(200));
      await writeFile(join(dir, "AGENTS.md"), "# Agent\nNo ref.");
      await writeFile(join(dir, "CLAUDE.md"), "# Project\nNo ref.");

      const result = await checkCharter(dir, 100);

      expect(result.passed).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("AGENTS.md or CLAUDE.md");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("passes when mix.exs has description", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-charter-"));
    try {
      const content = `defmodule MyApp.MixProject do
  def project do
    [app: :my_app, description: "${"A comprehensive Elixir application for managing distributed systems".padEnd(120, ".")}"]
  end
end`;
      await writeFile(join(dir, "mix.exs"), content);

      const result = await checkCharter(dir, 100);

      expect(result.passed).toBe(true);
      expect(result.sources.some((s) => s.file === "package description" && s.sufficient)).toBe(true);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("passes when pyproject.toml has description", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-charter-"));
    try {
      const content = `[project]
name = "my-app"
description = "${"A comprehensive Python application for data processing and analysis".padEnd(120, ".")}"`;
      await writeFile(join(dir, "pyproject.toml"), content);

      const result = await checkCharter(dir, 100);

      expect(result.passed).toBe(true);
      expect(result.sources.some((s) => s.file === "package description" && s.sufficient)).toBe(true);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("handles invalid package.json gracefully", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-charter-"));
    try {
      await writeFile(join(dir, "package.json"), "{invalid json}}");

      const result = await checkCharter(dir, 100);

      expect(result.passed).toBe(false);
      // Should not crash — just no package description source
      expect(result.sources.every((s) => s.file !== "package description")).toBe(true);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("ignores package.json with empty description", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-charter-"));
    try {
      await writeFile(join(dir, "package.json"), JSON.stringify({ description: "" }));

      const result = await checkCharter(dir, 100);

      expect(result.passed).toBe(false);
      expect(result.sources.every((s) => s.file !== "package description")).toBe(true);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("CLAUDE.md without Project Charter section is not a source", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-charter-"));
    try {
      await writeFile(join(dir, "CLAUDE.md"), "# Project\n\n## Setup\nSome instructions.");

      const result = await checkCharter(dir, 100);

      expect(result.passed).toBe(false);
      expect(result.sources.every((s) => !s.file.includes("CLAUDE.md"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("CLAUDE.md Project Charter section at end of file (no next heading)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-charter-"));
    try {
      const content = ["# My Project", "", "## Project Charter", "", `This project aims to ${"x".repeat(150)}`].join(
        "\n",
      );
      await writeFile(join(dir, "CLAUDE.md"), content);

      const result = await checkCharter(dir, 100);

      expect(result.passed).toBe(true);
      expect(result.sources.some((s) => s.file.includes("CLAUDE.md") && s.sufficient)).toBe(true);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
