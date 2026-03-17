import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  stampVersion,
  parseInstalledVersion,
  stripVersionField,
  compareVersions,
} from "./init.ts";
import { VERSION } from "../constants.ts";

describe("init helpers", () => {
  describe("stampVersion", () => {
    it("inserts hone-version before closing frontmatter delimiter", () => {
      const input = "---\nname: hone\n---\n# Content";
      const result = stampVersion(input);
      expect(result).toBe(`---\nname: hone\nhone-version: ${VERSION}\n---\n# Content`);
    });

    it("returns content unchanged if no closing frontmatter", () => {
      const input = "no frontmatter here";
      expect(stampVersion(input)).toBe(input);
    });
  });

  describe("parseInstalledVersion", () => {
    it("extracts version from frontmatter", () => {
      const content = "---\nname: hone\nhone-version: 1.2.0\n---\n# Content";
      expect(parseInstalledVersion(content)).toBe("1.2.0");
    });

    it("returns null when no version field", () => {
      const content = "---\nname: hone\n---\n# Content";
      expect(parseInstalledVersion(content)).toBeNull();
    });
  });

  describe("stripVersionField", () => {
    it("removes the hone-version line", () => {
      const content = "---\nname: hone\nhone-version: 1.2.0\n---\n# Content";
      expect(stripVersionField(content)).toBe("---\nname: hone\n---\n# Content");
    });

    it("leaves content unchanged when no version field", () => {
      const content = "---\nname: hone\n---\n# Content";
      expect(stripVersionField(content)).toBe(content);
    });
  });

  describe("compareVersions", () => {
    it("returns 0 for equal versions", () => {
      expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
    });

    it("returns -1 when first is older", () => {
      expect(compareVersions("1.2.0", "1.3.0")).toBe(-1);
    });

    it("returns 1 when first is newer", () => {
      expect(compareVersions("1.3.0", "1.2.0")).toBe(1);
    });

    it("handles patch version differences", () => {
      expect(compareVersions("1.2.1", "1.2.0")).toBe(1);
      expect(compareVersions("1.2.0", "1.2.1")).toBe(-1);
    });

    it("handles major version differences", () => {
      expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    });
  });
});

describe("init command integration", () => {
  const projectRoot = import.meta.dir + "/../..";
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hone-init-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it("creates skill files on fresh install", async () => {
    const proc = Bun.spawn(
      [process.execPath, "run", join(projectRoot, "src/cli.ts"), "init"],
      { stdout: "pipe", stderr: "pipe", cwd: tmpDir },
    );
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Created");
    expect(stdout).toContain("1 created");

    // Verify file exists and has version stamp
    const installed = await Bun.file(join(tmpDir, ".claude/skills/hone/SKILL.md")).text();
    expect(installed).toContain(`hone-version: ${VERSION}`);
    expect(installed).toContain("# Hone CLI");
  });

  it("reports up-to-date when same version already installed", async () => {
    // First install
    Bun.spawnSync(
      [process.execPath, "run", join(projectRoot, "src/cli.ts"), "init"],
      { stdout: "pipe", stderr: "pipe", cwd: tmpDir },
    );

    // Second install
    const proc = Bun.spawn(
      [process.execPath, "run", join(projectRoot, "src/cli.ts"), "init"],
      { stdout: "pipe", stderr: "pipe", cwd: tmpDir },
    );
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Up to date");
    expect(stdout).toContain("1 up to date");
  });

  it("updates when content differs with older version", async () => {
    // Install an older version with different content
    const skillDir = join(tmpDir, ".claude/skills/hone");
    await mkdir(skillDir, { recursive: true });
    await Bun.write(
      join(skillDir, "SKILL.md"),
      "---\nname: hone\nhone-version: 0.1.0\n---\n# Old content",
    );

    const proc = Bun.spawn(
      [process.execPath, "run", join(projectRoot, "src/cli.ts"), "init"],
      { stdout: "pipe", stderr: "pipe", cwd: tmpDir },
    );
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Updated");
    expect(stdout).toContain("1 updated");

    const installed = await Bun.file(join(skillDir, "SKILL.md")).text();
    expect(installed).toContain(`hone-version: ${VERSION}`);
    expect(installed).toContain("# Hone CLI");
  });

  it("refuses to overwrite newer version without --force", async () => {
    // Install a "newer" version
    const skillDir = join(tmpDir, ".claude/skills/hone");
    await mkdir(skillDir, { recursive: true });
    await Bun.write(
      join(skillDir, "SKILL.md"),
      "---\nname: hone\nhone-version: 99.0.0\n---\n# Future content",
    );

    const proc = Bun.spawn(
      [process.execPath, "run", join(projectRoot, "src/cli.ts"), "init"],
      { stdout: "pipe", stderr: "pipe", cwd: tmpDir },
    );
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(1);
    expect(stdout).toContain("Skipped");
    expect(stdout).toContain("v99.0.0");
    expect(stdout).toContain("--force");

    // Original file should be untouched
    const installed = await Bun.file(join(skillDir, "SKILL.md")).text();
    expect(installed).toContain("99.0.0");
    expect(installed).toContain("# Future content");
  });

  it("force-overwrites newer version with --force", async () => {
    // Install a "newer" version
    const skillDir = join(tmpDir, ".claude/skills/hone");
    await mkdir(skillDir, { recursive: true });
    await Bun.write(
      join(skillDir, "SKILL.md"),
      "---\nname: hone\nhone-version: 99.0.0\n---\n# Future content",
    );

    const proc = Bun.spawn(
      [process.execPath, "run", join(projectRoot, "src/cli.ts"), "init", "--force"],
      { stdout: "pipe", stderr: "pipe", cwd: tmpDir },
    );
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Updated");

    const installed = await Bun.file(join(skillDir, "SKILL.md")).text();
    expect(installed).toContain(`hone-version: ${VERSION}`);
    expect(installed).toContain("# Hone CLI");
  });

  it("outputs valid JSON with --json flag", async () => {
    const proc = Bun.spawn(
      [process.execPath, "run", join(projectRoot, "src/cli.ts"), "init", "--json"],
      { stdout: "pipe", stderr: "pipe", cwd: tmpDir },
    );
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.success).toBe(true);
    expect(result.version).toBe(VERSION);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].action).toBe("created");
  });
});
