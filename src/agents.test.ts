import { describe, expect, it } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentExists, agentNameFromFile, listAgents, readAgentContent, validateAgent } from "./agents.ts";
import { CliError } from "./errors.ts";

describe("agentNameFromFile", () => {
  it("should extract name from .agent.md files", () => {
    expect(agentNameFromFile("typescript-craftsperson.agent.md")).toBe("typescript-craftsperson");
  });

  it("should extract name from .md files", () => {
    expect(agentNameFromFile("my-agent.md")).toBe("my-agent");
  });

  it("should return null for non-markdown files", () => {
    expect(agentNameFromFile("notes.txt")).toBeNull();
    expect(agentNameFromFile("readme")).toBeNull();
  });

  it("should handle empty name with .agent.md suffix", () => {
    expect(agentNameFromFile(".agent.md")).toBe("");
  });

  it("should handle empty name with .md suffix", () => {
    expect(agentNameFromFile(".md")).toBe("");
  });

  it("should return null for files with no extension", () => {
    expect(agentNameFromFile("README")).toBeNull();
  });
});

describe("listAgents", () => {
  it("should list agents from .md and .agent.md files", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "agents-test-"));
    try {
      await writeFile(join(tempDir, "foo.md"), "# Foo Agent");
      await writeFile(join(tempDir, "bar.agent.md"), "# Bar Agent");
      await writeFile(join(tempDir, "readme.txt"), "Not an agent");

      const agents = await listAgents(tempDir);

      expect(agents).toHaveLength(2);
      expect(agents[0]).toEqual({ name: "bar", file: "bar.agent.md" });
      expect(agents[1]).toEqual({ name: "foo", file: "foo.md" });
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it("should return empty array for empty directory", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "agents-test-"));
    try {
      const agents = await listAgents(tempDir);
      expect(agents).toEqual([]);
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it("should return empty array for non-existent directory", async () => {
    const agents = await listAgents("/nonexistent/path");
    expect(agents).toEqual([]);
  });

  it("should sort agents alphabetically by name", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "agents-test-"));
    try {
      await writeFile(join(tempDir, "zebra.md"), "# Zebra");
      await writeFile(join(tempDir, "alpha.md"), "# Alpha");
      await writeFile(join(tempDir, "midpoint.md"), "# Midpoint");

      const agents = await listAgents(tempDir);

      expect(agents).toHaveLength(3);
      expect(agents[0]?.name).toBe("alpha");
      expect(agents[1]?.name).toBe("midpoint");
      expect(agents[2]?.name).toBe("zebra");
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it("should deduplicate, preferring .md over .agent.md", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "agents-test-"));
    try {
      await writeFile(join(tempDir, "foo.agent.md"), "# Foo Agent");
      await writeFile(join(tempDir, "foo.md"), "# Foo Plain");
      await writeFile(join(tempDir, "bar.md"), "# Bar Agent");

      const agents = await listAgents(tempDir);

      expect(agents).toHaveLength(2);
      expect(agents[0]).toEqual({ name: "bar", file: "bar.md" });
      expect(agents[1]).toEqual({ name: "foo", file: "foo.md" });
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it("should ignore files without .md or .agent.md extension", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "agents-test-"));
    try {
      await writeFile(join(tempDir, "valid.md"), "# Valid");
      await writeFile(join(tempDir, "script.sh"), "#!/bin/bash");
      await writeFile(join(tempDir, "notes.txt"), "Notes");
      await writeFile(join(tempDir, "config.json"), "{}");

      const agents = await listAgents(tempDir);

      expect(agents).toHaveLength(1);
      expect(agents[0]?.name).toBe("valid");
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });
});

describe("agentExists", () => {
  it("should return true when agent exists", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "agents-test-"));
    try {
      await writeFile(join(tempDir, "typescript-craftsperson.md"), "# TS Agent");

      const exists = await agentExists("typescript-craftsperson", tempDir);
      expect(exists).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it("should return false when agent does not exist", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "agents-test-"));
    try {
      await writeFile(join(tempDir, "other-agent.md"), "# Other");

      const exists = await agentExists("nonexistent", tempDir);
      expect(exists).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it("should return false for empty directory", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "agents-test-"));
    try {
      const exists = await agentExists("any-agent", tempDir);
      expect(exists).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it("should work with .md extension agents", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "agents-test-"));
    try {
      await writeFile(join(tempDir, "simple.md"), "# Simple Agent");

      const exists = await agentExists("simple", tempDir);
      expect(exists).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });
});

describe("readAgentContent", () => {
  it("should return file content when agent exists", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "agents-test-"));
    try {
      const content = "# TypeScript Craftsperson\n\nYou are an expert...";
      await writeFile(join(tempDir, "typescript-craftsperson.md"), content);

      const result = await readAgentContent("typescript-craftsperson", tempDir);
      expect(result).toBe(content);
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it("should return null when agent does not exist", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "agents-test-"));
    try {
      const result = await readAgentContent("nonexistent", tempDir);
      expect(result).toBeNull();
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it("should work with .md extension agents", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "agents-test-"));
    try {
      const content = "# Simple Agent Content";
      await writeFile(join(tempDir, "simple.md"), content);

      const result = await readAgentContent("simple", tempDir);
      expect(result).toBe(content);
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it("should return null when file read fails", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "agents-test-"));
    try {
      // Create a file with no read permissions
      const agentFile = join(tempDir, "locked.agent.md");
      await writeFile(agentFile, "# Locked Agent");
      await chmod(agentFile, 0o000);

      const result = await readAgentContent("locked", tempDir);
      expect(result).toBeNull();
    } finally {
      // Restore permissions before cleanup
      try {
        await chmod(join(tempDir, "locked.agent.md"), 0o644);
      } catch {
        // Ignore cleanup errors
      }
      await rm(tempDir, { recursive: true });
    }
  });

  it("should handle multiline content correctly", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "agents-test-"));
    try {
      const content = `# Agent Title

## Section 1
Content here.

## Section 2
More content.`;
      await writeFile(join(tempDir, "multi.md"), content);

      const result = await readAgentContent("multi", tempDir);
      expect(result).toBe(content);
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });
});

describe("validateAgent", () => {
  it("should throw CliError when agent does not exist in either directory", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "agents-test-"));
    try {
      await expect(validateAgent("nonexistent-agent", tempDir)).rejects.toThrow(CliError);
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it("should throw CliError with informative message when agent does not exist", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "agents-test-"));
    try {
      await expect(validateAgent("nonexistent-agent", tempDir)).rejects.toThrow("Agent 'nonexistent-agent' not found");
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it("should not throw when agent exists in the local directory", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "agents-test-"));
    try {
      await writeFile(join(tempDir, "my-agent.md"), "# My Agent");

      await expect(validateAgent("my-agent", tempDir)).resolves.toBeUndefined();
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });
});
