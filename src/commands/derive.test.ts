import { describe, it, expect, spyOn } from "bun:test";
import { join } from "path";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { updateFrontmatterName, deriveCommand } from "./derive.ts";
import type { ParsedArgs } from "../types.ts";
import { createDeriveMock, extractPrompt } from "../test-helpers.ts";

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
    // Rest of content is preserved
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

    // No name field to replace — content stays the same
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
// deriveCommand — happy path with injected deps
// ---------------------------------------------------------------------------

const CANNED_AGENT_CONTENT = `---
name: bun-typescript-craftsperson
description: A TypeScript craftsperson agent for Bun projects
---

# Bun TypeScript Craftsperson

## Engineering Principles
1. Write tests first
`;

const CANNED_GATES_JSON = `[{"name":"test","command":"bun test","required":true},{"name":"typecheck","command":"bunx tsc --noEmit","required":true}]`;

function makeDeriveParsed(folder: string, extra: Record<string, string | boolean> = {}): ParsedArgs {
  return {
    command: "derive",
    positional: [folder],
    flags: extra,
  };
}

describe("deriveCommand", () => {
  describe("argument validation", () => {
    it("exits with error when no folder is provided", async () => {
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      const exitSpy = spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      const parsed: ParsedArgs = { command: "derive", positional: [], flags: {} };
      await expect(deriveCommand(parsed)).rejects.toThrow("process.exit called");
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Usage: hone derive"));

      errorSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });

  describe("local mode (default)", () => {
    it("writes agent file to <folder>/.claude/agents/<name>.md", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-derive-cmd-"));
      try {
        const claude = createDeriveMock({
          derive: CANNED_AGENT_CONTENT,
          gateExtraction: CANNED_GATES_JSON,
        });

        const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
        try {
          await deriveCommand(makeDeriveParsed(tmpDir), { claude });
        } finally {
          consoleSpy.mockRestore();
        }

        const agentPath = join(tmpDir, ".claude", "agents", "bun-typescript-craftsperson.md");
        const written = await Bun.file(agentPath).text();
        expect(written).toContain("Bun TypeScript Craftsperson");
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });

    it("writes .hone-gates.json when gates are extracted", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-derive-cmd-"));
      try {
        const claude = createDeriveMock({
          derive: CANNED_AGENT_CONTENT,
          gateExtraction: CANNED_GATES_JSON,
        });

        const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
        try {
          await deriveCommand(makeDeriveParsed(tmpDir), { claude });
        } finally {
          consoleSpy.mockRestore();
        }

        const gatesPath = join(tmpDir, ".hone-gates.json");
        const gatesFile = await Bun.file(gatesPath).json();
        expect(gatesFile.gates).toBeArray();
        expect(gatesFile.gates.length).toBe(2);
        expect(gatesFile.gates[0].name).toBe("test");
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });

    it("does not write .hone-gates.json when no gates are extracted", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-derive-cmd-"));
      try {
        const claude = createDeriveMock({
          derive: CANNED_AGENT_CONTENT,
          gateExtraction: "[]",
        });

        const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
        try {
          await deriveCommand(makeDeriveParsed(tmpDir), { claude });
        } finally {
          consoleSpy.mockRestore();
        }

        const gatesFile = Bun.file(join(tmpDir, ".hone-gates.json"));
        expect(await gatesFile.exists()).toBe(false);
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });
  });

  describe("--name override", () => {
    it("uses the overridden name for the agent file and updates frontmatter", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-derive-cmd-"));
      try {
        const claude = createDeriveMock({
          derive: CANNED_AGENT_CONTENT,
          gateExtraction: "[]",
        });

        const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
        try {
          await deriveCommand(makeDeriveParsed(tmpDir, { name: "my-custom-agent" }), { claude });
        } finally {
          consoleSpy.mockRestore();
        }

        const agentPath = join(tmpDir, ".claude", "agents", "my-custom-agent.md");
        const written = await Bun.file(agentPath).text();
        expect(written).toContain("name: my-custom-agent");
        // Original name from Claude output should be replaced
        expect(written).not.toContain("name: bun-typescript-craftsperson");
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Conflict resolution — pre-seed agent file to trigger conflict detection
  // ---------------------------------------------------------------------------

  describe("conflict resolution", () => {
    async function seedExistingAgent(agentDir: string, agentName: string): Promise<void> {
      await mkdir(agentDir, { recursive: true });
      await writeFile(
        join(agentDir, `${agentName}.md`),
        `---\nname: ${agentName}\ndescription: Existing agent\n---\n\n# Existing\n`,
      );
    }

    it("overwrites existing agent file when user chooses 'o'", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-derive-cmd-"));
      try {
        const agentDir = join(tmpDir, ".claude", "agents");
        await seedExistingAgent(agentDir, "bun-typescript-craftsperson");

        const claude = createDeriveMock({
          derive: CANNED_AGENT_CONTENT,
          gateExtraction: "[]",
        });
        const prompt = async () => "o";

        const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
        try {
          await deriveCommand(makeDeriveParsed(tmpDir), { claude, prompt });
        } finally {
          consoleSpy.mockRestore();
        }

        const agentPath = join(agentDir, "bun-typescript-craftsperson.md");
        const written = await Bun.file(agentPath).text();
        expect(written).toContain("Bun TypeScript Craftsperson");
        // New content, not the seeded "Existing" content
        expect(written).not.toContain("# Existing");
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });

    it("returns early without writing when user chooses 'a' (abort)", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-derive-cmd-"));
      try {
        const agentDir = join(tmpDir, ".claude", "agents");
        await seedExistingAgent(agentDir, "bun-typescript-craftsperson");

        const claude = createDeriveMock({
          derive: CANNED_AGENT_CONTENT,
          gateExtraction: "[]",
        });
        const prompt = async () => "a";

        const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
        try {
          await deriveCommand(makeDeriveParsed(tmpDir), { claude, prompt });
        } finally {
          consoleSpy.mockRestore();
        }

        // Existing file remains unchanged
        const agentPath = join(agentDir, "bun-typescript-craftsperson.md");
        const existing = await Bun.file(agentPath).text();
        expect(existing).toContain("# Existing");
        expect(existing).not.toContain("Bun TypeScript Craftsperson");
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });

    it("writes expanded-name file when user chooses 'e' (expand)", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-derive-cmd-"));
      try {
        const agentDir = join(tmpDir, ".claude", "agents");
        await seedExistingAgent(agentDir, "bun-typescript-craftsperson");

        // The mock must handle both the derive call AND the suggestExpandedName call
        let callCount = 0;
        const claude = async (args: string[]): Promise<string> => {
          callCount++;
          const prompt = extractPrompt(args);
          if (prompt.includes("creating a custom craftsperson agent")) {
            return CANNED_AGENT_CONTENT;
          }
          if (prompt.includes("already exists")) {
            // suggestExpandedName call — return a non-conflicting name
            return "bun-typescript-hone-craftsperson";
          }
          // gate extraction
          return "[]";
        };
        const prompt = async () => "e";

        const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
        try {
          await deriveCommand(makeDeriveParsed(tmpDir), { claude, prompt });
        } finally {
          consoleSpy.mockRestore();
        }

        // New file is written with the expanded name
        const newAgentPath = join(agentDir, "bun-typescript-hone-craftsperson.md");
        const written = await Bun.file(newAgentPath).text();
        expect(written).toContain("name: bun-typescript-hone-craftsperson");
        // Original conflicting file is untouched
        const oldAgentPath = join(agentDir, "bun-typescript-craftsperson.md");
        const existing = await Bun.file(oldAgentPath).text();
        expect(existing).toContain("# Existing");
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });

    it("uses existing agent path and skips write when user chooses 'm' (merge)", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-derive-cmd-"));
      try {
        const agentDir = join(tmpDir, ".claude", "agents");
        await seedExistingAgent(agentDir, "bun-typescript-craftsperson");

        // merge triggers a mix() call — the mock receives a principles-mix prompt
        const claude = async (args: string[]): Promise<string> => {
          const prompt = extractPrompt(args);
          if (prompt.includes("creating a custom craftsperson agent")) {
            return CANNED_AGENT_CONTENT;
          }
          // mix principles or gates prompt — Claude edits the file directly; stdout ignored
          return "";
        };
        const prompt = async () => "m";

        const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
        try {
          await deriveCommand(makeDeriveParsed(tmpDir), { claude, prompt });
        } finally {
          consoleSpy.mockRestore();
        }

        // Existing file path is still there (mix edits in-place)
        const agentPath = join(agentDir, "bun-typescript-craftsperson.md");
        expect(await Bun.file(agentPath).exists()).toBe(true);
        // No new file created with the same name (no overwrite)
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });
  });
});
