import { describe, it, expect } from "bun:test";
import { resolve } from "path";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { parseGatesArgs } from "./gates.ts";

describe("parseGatesArgs", () => {
  it("should parse two positionals as agent + folder", () => {
    const result = parseGatesArgs(["my-agent", "./project"]);
    expect(result.agentName).toBe("my-agent");
    expect(result.folder).toBe(resolve("./project"));
  });

  it("should parse single word without slash or dot prefix as agent name", () => {
    const result = parseGatesArgs(["my-agent"]);
    expect(result.agentName).toBe("my-agent");
    expect(result.folder).toBe(resolve("."));
  });

  it("should parse path starting with dot as folder only", () => {
    const result = parseGatesArgs(["./src"]);
    expect(result.agentName).toBeUndefined();
    expect(result.folder).toBe(resolve("./src"));
  });

  it("should parse path containing slash as folder only", () => {
    const result = parseGatesArgs(["src/app"]);
    expect(result.agentName).toBeUndefined();
    expect(result.folder).toBe(resolve("src/app"));
  });

  it("should default to current directory when no args provided", () => {
    const result = parseGatesArgs([]);
    expect(result.agentName).toBeUndefined();
    expect(result.folder).toBe(resolve("."));
  });

  it("should handle absolute folder path with agent", () => {
    const result = parseGatesArgs(["typescript-craftsperson", "/absolute/path"]);
    expect(result.agentName).toBe("typescript-craftsperson");
    expect(result.folder).toBe("/absolute/path");
  });

  it("should handle kebab-case agent names", () => {
    const result = parseGatesArgs(["typescript-craftsperson"]);
    expect(result.agentName).toBe("typescript-craftsperson");
    expect(result.folder).toBe(resolve("."));
  });

  it("should treat single dot as folder path", () => {
    const result = parseGatesArgs(["."]);
    expect(result.agentName).toBeUndefined();
    expect(result.folder).toBe(resolve("."));
  });

  it("should treat double dots as folder path", () => {
    const result = parseGatesArgs([".."]);
    expect(result.agentName).toBeUndefined();
    expect(result.folder).toBe(resolve(".."));
  });

  it("should handle relative paths with slash", () => {
    const result = parseGatesArgs(["test/fixtures"]);
    expect(result.agentName).toBeUndefined();
    expect(result.folder).toBe(resolve("test/fixtures"));
  });

  it("should handle agent name with numbers", () => {
    const result = parseGatesArgs(["agent-v2"]);
    expect(result.agentName).toBe("agent-v2");
    expect(result.folder).toBe(resolve("."));
  });

  it("should handle path starting with slash as folder", () => {
    const result = parseGatesArgs(["/usr/local"]);
    expect(result.agentName).toBeUndefined();
    expect(result.folder).toBe("/usr/local");
  });

  it("should handle agent with relative path containing ..", () => {
    const result = parseGatesArgs(["my-agent", "../parent"]);
    expect(result.agentName).toBe("my-agent");
    expect(result.folder).toBe(resolve("../parent"));
  });

  it("should handle path with dot in directory name", () => {
    const result = parseGatesArgs(["src/v1.0"]);
    expect(result.agentName).toBeUndefined();
    expect(result.folder).toBe(resolve("src/v1.0"));
  });
});

describe("gates command integration", () => {
  const projectRoot = import.meta.dir + "/../..";

  it("should show no gates message for empty directory", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "gates-test-"));
    try {
      const proc = Bun.spawn(["bun", "run", "src/cli.ts", "gates", tempDir], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: projectRoot,
      });
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);
      expect(stdout).toContain("No quality gates found");
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it("should list gates from .hone-gates.json", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "gates-test-"));
    try {
      const gatesConfig = {
        gates: [
          { name: "test", command: "bun test", required: true },
          { name: "lint", command: "bun run lint", required: false },
        ],
      };
      await writeFile(join(tempDir, ".hone-gates.json"), JSON.stringify(gatesConfig, null, 2));

      const proc = Bun.spawn(["bun", "run", "src/cli.ts", "gates", tempDir], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: projectRoot,
      });
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Quality gates");
      expect(stdout).toContain("test: bun test");
      expect(stdout).toContain("lint: bun run lint");
      expect(stdout).toContain("required");
      expect(stdout).toContain("optional");
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it("should run gates with --run flag", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "gates-test-"));
    try {
      const gatesConfig = {
        gates: [
          { name: "pass", command: "true", required: true },
        ],
      };
      await writeFile(join(tempDir, ".hone-gates.json"), JSON.stringify(gatesConfig, null, 2));

      const proc = Bun.spawn(["bun", "run", "src/cli.ts", "gates", tempDir, "--run"], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: projectRoot,
      });
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Running quality gates");
      expect(stdout).toContain("PASS");
      expect(stdout).toContain("All required gates passed");
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it("should save gates with --save flag", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "gates-test-"));
    try {
      // Create a gates file to be saved
      const gatesConfig = {
        gates: [
          { name: "test", command: "echo test", required: true },
        ],
      };
      await writeFile(join(tempDir, ".hone-gates.json"), JSON.stringify(gatesConfig, null, 2));

      const proc = Bun.spawn(["bun", "run", "src/cli.ts", "gates", tempDir, "--save"], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: projectRoot,
      });
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Gates written to:");
      expect(stdout).toContain(".hone-gates.json");
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });
});
