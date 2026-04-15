import { describe, expect, it, spyOn } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDefaultConfig } from "./config.ts";
import type { ProjectContext } from "./derive.ts";
import { type ConflictContext, resolveConflict, updateFrontmatterName } from "./derive-conflict.ts";
import { CliError } from "./errors.ts";

// ---------------------------------------------------------------------------
// updateFrontmatterName — pure function, no side effects
// ---------------------------------------------------------------------------

describe("updateFrontmatterName", () => {
  it("replaces an existing name field in valid frontmatter", () => {
    const content = `---
name: old-craftsperson
description: An old agent
---

# Old Craftsperson`;

    const result = updateFrontmatterName(content, "new-craftsperson");

    expect(result).toContain("name: new-craftsperson");
    expect(result).not.toContain("name: old-craftsperson");
    expect(result).toContain("description: An old agent");
    expect(result).toContain("# Old Craftsperson");
  });

  it("returns content unchanged when there is no frontmatter", () => {
    const content = "# My Agent\n\nSome content without frontmatter.";

    const result = updateFrontmatterName(content, "new-name");

    expect(result).toBe(content);
  });

  it("returns content unchanged when frontmatter has no name field", () => {
    const content = `---
description: No name field here
---

# Agent Body`;

    const result = updateFrontmatterName(content, "new-name");

    expect(result).toBe(content);
  });

  it("handles frontmatter-only content", () => {
    const content = `---
name: original
description: desc
---`;

    const result = updateFrontmatterName(content, "replaced");

    expect(result).toContain("name: replaced");
    expect(result).not.toContain("name: original");
  });
});

// ---------------------------------------------------------------------------
// resolveConflict — all branches
// ---------------------------------------------------------------------------

const EXISTING_AGENT_CONTENT = `---
name: bun-typescript-craftsperson
description: Existing agent
---

# Existing
`;

const NEW_AGENT_CONTENT = `---
name: bun-typescript-craftsperson
description: A new TypeScript craftsperson agent
---

# New Content
`;

const MINIMAL_CONTEXT: ProjectContext = {
  directoryTree: "",
  packageFiles: ["package.json"],
  ciConfigs: [],
  toolConfigs: ["tsconfig.json"],
  shellScripts: [],
  lockfiles: [{ file: "bun.lockb", packageManager: "bun" }],
};

async function seedAgentFile(agentDir: string, agentName: string, content: string): Promise<void> {
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, `${agentName}.md`), content);
}

function makeConflictContext(agentDir: string, overrides: Partial<ConflictContext> = {}): ConflictContext {
  const config = getDefaultConfig();
  return {
    agentName: "bun-typescript-craftsperson",
    agentDir,
    agentContent: NEW_AGENT_CONTENT,
    context: MINIMAL_CONTEXT,
    existingAgentNames: ["bun-typescript-craftsperson"],
    isJson: false,
    config,
    claude: async () => "",
    prompt: async () => "a",
    readOnlyTools: config.readOnlyTools,
    ...overrides,
  };
}

describe("resolveConflict", () => {
  describe("JSON mode", () => {
    it("writes a JSON error payload and throws CliError when isJson is true", async () => {
      const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      try {
        const ctx = makeConflictContext("/tmp/irrelevant", { isJson: true });
        await expect(resolveConflict(ctx)).rejects.toThrow(CliError);
        // The JSON payload must be written to stdout
        expect(consoleSpy).toHaveBeenCalled();
        const written = consoleSpy.mock.calls[0]?.[0] as string;
        const parsed = JSON.parse(written);
        expect(parsed.error).toBe("agent_name_conflict");
        expect(parsed.conflictingName).toBe("bun-typescript-craftsperson");
      } finally {
        consoleSpy.mockRestore();
        errorSpy.mockRestore();
      }
    });
  });

  describe("overwrite (choice 'o')", () => {
    it("returns the original agentName and agentContent with skipWrite false", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-derive-conflict-"));
      try {
        await seedAgentFile(tmpDir, "bun-typescript-craftsperson", EXISTING_AGENT_CONTENT);

        const ctx = makeConflictContext(tmpDir, { prompt: async () => "o" });
        const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
        const errorSpy = spyOn(console, "error").mockImplementation(() => {});
        try {
          const result = await resolveConflict(ctx);
          expect(result).not.toBeNull();
          expect(result?.agentName).toBe("bun-typescript-craftsperson");
          expect(result?.agentContent).toBe(NEW_AGENT_CONTENT);
          expect(result?.skipWrite).toBe(false);
        } finally {
          consoleSpy.mockRestore();
          errorSpy.mockRestore();
        }
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });
  });

  describe("abort (choice 'a')", () => {
    it("returns null", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-derive-conflict-"));
      try {
        await seedAgentFile(tmpDir, "bun-typescript-craftsperson", EXISTING_AGENT_CONTENT);

        const ctx = makeConflictContext(tmpDir, { prompt: async () => "a" });
        const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
        const errorSpy = spyOn(console, "error").mockImplementation(() => {});
        try {
          const result = await resolveConflict(ctx);
          expect(result).toBeNull();
        } finally {
          consoleSpy.mockRestore();
          errorSpy.mockRestore();
        }
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });
  });

  describe("expand (choice 'e')", () => {
    it("returns a new non-conflicting name with updated frontmatter and skipWrite false", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-derive-conflict-"));
      try {
        await seedAgentFile(tmpDir, "bun-typescript-craftsperson", EXISTING_AGENT_CONTENT);

        const claude = async () => "bun-typescript-hone-craftsperson";
        const ctx = makeConflictContext(tmpDir, {
          prompt: async () => "e",
          claude,
        });

        const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
        const errorSpy = spyOn(console, "error").mockImplementation(() => {});
        try {
          const result = await resolveConflict(ctx);
          expect(result).not.toBeNull();
          expect(result?.agentName).toBe("bun-typescript-hone-craftsperson");
          expect(result?.agentContent).toContain("name: bun-typescript-hone-craftsperson");
          expect(result?.skipWrite).toBe(false);
        } finally {
          consoleSpy.mockRestore();
          errorSpy.mockRestore();
        }
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });

    it("throws CliError when the expanded name also conflicts", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-derive-conflict-"));
      try {
        await seedAgentFile(tmpDir, "bun-typescript-craftsperson", EXISTING_AGENT_CONTENT);
        // Plant the "expanded" name as well so it also conflicts
        await seedAgentFile(tmpDir, "bun-typescript-hone-craftsperson", EXISTING_AGENT_CONTENT);

        const claude = async () => "bun-typescript-hone-craftsperson";
        const ctx = makeConflictContext(tmpDir, {
          prompt: async () => "e",
          claude,
          existingAgentNames: ["bun-typescript-craftsperson", "bun-typescript-hone-craftsperson"],
        });

        const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
        const errorSpy = spyOn(console, "error").mockImplementation(() => {});
        try {
          await expect(resolveConflict(ctx)).rejects.toThrow(CliError);
        } finally {
          consoleSpy.mockRestore();
          errorSpy.mockRestore();
        }
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });
  });

  describe("merge (choice 'm')", () => {
    it("returns original agentName with skipWrite true (mix handles the write)", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-derive-conflict-"));
      try {
        await seedAgentFile(tmpDir, "bun-typescript-craftsperson", EXISTING_AGENT_CONTENT);

        // The merge path calls mix() which calls claude — return empty string (stdout ignored)
        const claude = async () => "";
        const ctx = makeConflictContext(tmpDir, {
          prompt: async () => "m",
          claude,
        });

        const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
        const errorSpy = spyOn(console, "error").mockImplementation(() => {});
        try {
          const result = await resolveConflict(ctx);
          expect(result).not.toBeNull();
          expect(result?.agentName).toBe("bun-typescript-craftsperson");
          expect(result?.skipWrite).toBe(true);
        } finally {
          consoleSpy.mockRestore();
          errorSpy.mockRestore();
        }
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });
  });
});
