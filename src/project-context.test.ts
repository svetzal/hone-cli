import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatherContext } from "./project-context.ts";

describe("gatherContext", () => {
  test("collects directory tree", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      await mkdir(join(dir, "src"));
      await writeFile(join(dir, "src", "index.ts"), "console.log('hi')");
      await writeFile(join(dir, "package.json"), '{"name":"test"}');

      const ctx = await gatherContext(dir);

      expect(ctx.directoryTree).toContain("src/");
      expect(ctx.directoryTree).toContain("package.json");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("detects package files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      await writeFile(join(dir, "package.json"), '{"name":"test","scripts":{"test":"bun test"}}');

      const ctx = await gatherContext(dir);

      expect(ctx.packageFiles).toContain("package.json");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("detects tool config files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      await writeFile(join(dir, "tsconfig.json"), '{"compilerOptions":{}}');

      const ctx = await gatherContext(dir);

      expect(ctx.toolConfigs).toContain("tsconfig.json");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("skips node_modules and hidden dirs in tree", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      await mkdir(join(dir, "node_modules"));
      await writeFile(join(dir, "node_modules", "pkg.json"), "{}");
      await mkdir(join(dir, ".git"));
      await writeFile(join(dir, ".git", "config"), "");
      await writeFile(join(dir, "app.ts"), "");

      const ctx = await gatherContext(dir);

      expect(ctx.directoryTree).toContain("app.ts");
      expect(ctx.directoryTree).not.toContain("node_modules");
      expect(ctx.directoryTree).not.toContain(".git");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("handles empty project directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      const ctx = await gatherContext(dir);

      expect(ctx.directoryTree).toBe("");
      expect(ctx.packageFiles).toEqual([]);
      expect(ctx.ciConfigs).toEqual([]);
      expect(ctx.toolConfigs).toEqual([]);
      expect(ctx.shellScripts).toEqual([]);
      expect(ctx.lockfiles).toEqual([]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("detects lockfiles and maps to package managers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      await writeFile(join(dir, "bun.lockb"), "");
      await writeFile(join(dir, "package.json"), "{}");

      const ctx = await gatherContext(dir);

      expect(ctx.lockfiles).toEqual([{ file: "bun.lockb", packageManager: "bun" }]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("detects multiple lockfiles", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      await writeFile(join(dir, "uv.lock"), "");
      await writeFile(join(dir, "poetry.lock"), "");

      const ctx = await gatherContext(dir);

      const managers = ctx.lockfiles.map((l) => l.packageManager).sort();
      expect(managers).toContain("uv");
      expect(managers).toContain("poetry");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("detects CI configs in directory-based pattern (.github/workflows)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      await mkdir(join(dir, ".github", "workflows"), { recursive: true });
      await writeFile(join(dir, ".github", "workflows", "ci.yml"), "on: push");
      await writeFile(join(dir, ".github", "workflows", "release.yml"), "on: push");

      const ctx = await gatherContext(dir);

      expect(ctx.ciConfigs).toContain(".github/workflows/ci.yml");
      expect(ctx.ciConfigs).toContain(".github/workflows/release.yml");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("caps directory-based CI configs at 5 entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      await mkdir(join(dir, ".github", "workflows"), { recursive: true });
      for (let i = 1; i <= 7; i++) {
        await writeFile(join(dir, ".github", "workflows", `workflow${i}.yml`), "on: push");
      }

      const ctx = await gatherContext(dir);

      const workflowEntries = ctx.ciConfigs.filter((c) => c.startsWith(".github/workflows/"));
      expect(workflowEntries.length).toBe(5);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("detects file-based CI configs (.gitlab-ci.yml)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      await writeFile(join(dir, ".gitlab-ci.yml"), "stages: [test]");

      const ctx = await gatherContext(dir);

      expect(ctx.ciConfigs).toContain(".gitlab-ci.yml");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("detects shell scripts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      await writeFile(join(dir, "deploy.sh"), "#!/bin/bash");
      await writeFile(join(dir, "setup.sh"), "#!/bin/bash");
      await writeFile(join(dir, "readme.txt"), "not a script");

      const ctx = await gatherContext(dir);

      expect(ctx.shellScripts).toContain("deploy.sh");
      expect(ctx.shellScripts).toContain("setup.sh");
      expect(ctx.shellScripts).not.toContain("readme.txt");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("listDirectoryTree respects depth limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      await mkdir(join(dir, "a", "b", "c"), { recursive: true });
      await writeFile(join(dir, "a", "level1.ts"), "");
      await writeFile(join(dir, "a", "b", "level2.ts"), "");
      await writeFile(join(dir, "a", "b", "c", "level3.ts"), "");

      const ctx = await gatherContext(dir);

      // default depth=3: root (depth 3) → a (depth 2) → b (depth 1) → c NOT entered (1 not > 1)
      expect(ctx.directoryTree).toContain("level1.ts");
      expect(ctx.directoryTree).toContain("level2.ts");
      expect(ctx.directoryTree).not.toContain("level3.ts");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("listDirectoryTree filters all excluded directories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      for (const excluded of ["_build", "deps", "__pycache__", "target", "dist", "build"]) {
        await mkdir(join(dir, excluded));
        await writeFile(join(dir, excluded, "file.txt"), "");
      }
      await mkdir(join(dir, "src"));
      await writeFile(join(dir, "src", "main.ts"), "");

      const ctx = await gatherContext(dir);

      expect(ctx.directoryTree).toContain("src/");
      for (const excluded of ["_build", "deps", "__pycache__", "target", "dist", "build"]) {
        expect(ctx.directoryTree).not.toContain(excluded);
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("excludes package files from toolConfigs to avoid duplication", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      await writeFile(join(dir, "pyproject.toml"), "[project]");
      await writeFile(join(dir, "ruff.toml"), "[tool.ruff]");

      const ctx = await gatherContext(dir);

      expect(ctx.packageFiles).toContain("pyproject.toml");
      expect(ctx.toolConfigs).toContain("ruff.toml");
      expect(ctx.toolConfigs).not.toContain("pyproject.toml");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("returns empty context for nonexistent folder", async () => {
    const ctx = await gatherContext("/nonexistent/path/that/does/not/exist");

    expect(ctx.directoryTree).toBe("");
    expect(ctx.packageFiles).toEqual([]);
    expect(ctx.ciConfigs).toEqual([]);
    expect(ctx.toolConfigs).toEqual([]);
    expect(ctx.shellScripts).toEqual([]);
    expect(ctx.lockfiles).toEqual([]);
  });
});
