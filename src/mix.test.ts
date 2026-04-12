import { describe, expect, test } from "bun:test";
import type { FileReader } from "./mix.ts";
import { buildGatesMixPrompt, buildPrinciplesMixPrompt, mix } from "./mix.ts";
import { createMixMock, extractPrompt } from "./test-helpers.ts";

const LOCAL_AGENT = `---
name: local-craftsperson
description: Local agent
---

# Local Craftsperson

## Engineering Principles
1. Keep it simple

## QA Checkpoints
- Run \`bun test\``;

const FOREIGN_AGENT = `---
name: foreign-craftsperson
description: Foreign agent
---

# Foreign Craftsperson

## Engineering Principles
1. Keep it simple
2. Test everything

## QA Checkpoints
- Run \`bun test\`
- Run \`bunx tsc --noEmit\``;

const AGENT_PATH = "/tmp/test-agent.md";

describe("buildPrinciplesMixPrompt", () => {
  test("includes foreign agent content and file path", () => {
    const prompt = buildPrinciplesMixPrompt(FOREIGN_AGENT, AGENT_PATH);
    expect(prompt).toContain(FOREIGN_AGENT);
    expect(prompt).toContain(AGENT_PATH);
  });

  test("does not embed local agent content", () => {
    const prompt = buildPrinciplesMixPrompt(FOREIGN_AGENT, AGENT_PATH);
    expect(prompt).not.toContain(LOCAL_AGENT);
  });

  test("instructs to only modify principles", () => {
    const prompt = buildPrinciplesMixPrompt(FOREIGN_AGENT, AGENT_PATH);
    expect(prompt).toContain("ONLY modify sections related to engineering principles");
  });

  test("forbids touching gates", () => {
    const prompt = buildPrinciplesMixPrompt(FOREIGN_AGENT, AGENT_PATH);
    expect(prompt).toContain("DO NOT touch QA checkpoints");
  });

  test("instructs to use Edit tool", () => {
    const prompt = buildPrinciplesMixPrompt(FOREIGN_AGENT, AGENT_PATH);
    expect(prompt).toContain("Edit tool");
  });
});

describe("buildGatesMixPrompt", () => {
  test("includes foreign agent content and file path", () => {
    const prompt = buildGatesMixPrompt(FOREIGN_AGENT, AGENT_PATH);
    expect(prompt).toContain(FOREIGN_AGENT);
    expect(prompt).toContain(AGENT_PATH);
  });

  test("does not embed local agent content", () => {
    const prompt = buildGatesMixPrompt(FOREIGN_AGENT, AGENT_PATH);
    expect(prompt).not.toContain(LOCAL_AGENT);
  });

  test("instructs to only modify gates", () => {
    const prompt = buildGatesMixPrompt(FOREIGN_AGENT, AGENT_PATH);
    expect(prompt).toContain("ONLY modify sections related to QA checkpoints");
  });

  test("forbids touching principles", () => {
    const prompt = buildGatesMixPrompt(FOREIGN_AGENT, AGENT_PATH);
    expect(prompt).toContain("DO NOT touch engineering principles");
  });

  test("instructs to use Edit tool", () => {
    const prompt = buildGatesMixPrompt(FOREIGN_AGENT, AGENT_PATH);
    expect(prompt).toContain("Edit tool");
  });
});

describe("mix", () => {
  test("principles-only: 1 Claude call, no gate extraction", async () => {
    let callCount = 0;
    let fileContent = LOCAL_AGENT;
    const mock = createMixMock(
      { principles: "updated agent with principles" },
      {
        onCall: () => {
          callCount++;
        },
        onEdit: (content) => {
          fileContent = content;
        },
      },
    );
    const mockReadFile: FileReader = async () => fileContent;

    const result = await mix(
      {
        agentPath: AGENT_PATH,
        foreignAgentContent: FOREIGN_AGENT,
        mixPrinciples: true,
        mixGates: false,
        model: "opus",
        gatesModel: "sonnet",
        readOnlyTools: "Read Glob Grep",
      },
      mock,
      mockReadFile,
    );

    expect(callCount).toBe(1);
    expect(result.principlesMixed).toBe(true);
    expect(result.gatesMixed).toBe(false);
    expect(result.gates).toBeNull();
    expect(result.updatedAgentContent).toBe("updated agent with principles");
  });

  test("gates-only: 1 Claude call + 1 gate extraction call", async () => {
    let callCount = 0;
    let fileContent = LOCAL_AGENT;
    const mock = createMixMock(
      {
        gates: "updated agent with gates",
        gateExtraction: JSON.stringify([
          { name: "test", command: "bun test", required: true },
          { name: "typecheck", command: "bunx tsc --noEmit", required: true },
        ]),
      },
      {
        onCall: () => {
          callCount++;
        },
        onEdit: (content) => {
          fileContent = content;
        },
      },
    );
    const mockReadFile: FileReader = async () => fileContent;

    const result = await mix(
      {
        agentPath: AGENT_PATH,
        foreignAgentContent: FOREIGN_AGENT,
        mixPrinciples: false,
        mixGates: true,
        model: "opus",
        gatesModel: "sonnet",
        readOnlyTools: "Read Glob Grep",
      },
      mock,
      mockReadFile,
    );

    expect(callCount).toBe(2); // gates mix + gate extraction
    expect(result.principlesMixed).toBe(false);
    expect(result.gatesMixed).toBe(true);
    expect(result.gates).not.toBeNull();
    expect(result.gates?.length).toBe(2);
    expect(result.updatedAgentContent).toBe("updated agent with gates");
  });

  test("both flags: 2 Claude calls + 1 gate extraction, in correct order", async () => {
    const prompts: string[] = [];
    let fileContent = LOCAL_AGENT;
    const mock = createMixMock(
      {
        principles: "agent after principles mix",
        gates: "agent after gates mix",
        gateExtraction: JSON.stringify([{ name: "test", command: "bun test", required: true }]),
      },
      {
        onCall: (args) => {
          prompts.push(extractPrompt(args));
        },
        onEdit: (content) => {
          fileContent = content;
        },
      },
    );
    const mockReadFile: FileReader = async () => fileContent;

    const result = await mix(
      {
        agentPath: AGENT_PATH,
        foreignAgentContent: FOREIGN_AGENT,
        mixPrinciples: true,
        mixGates: true,
        model: "opus",
        gatesModel: "sonnet",
        readOnlyTools: "Read Glob Grep",
      },
      mock,
      mockReadFile,
    );

    expect(prompts.length).toBe(3); // principles + gates + gate extraction
    expect(prompts[0]).toContain("engineering principles");
    expect(prompts[1]).toContain("quality assurance");
    expect(result.principlesMixed).toBe(true);
    expect(result.gatesMixed).toBe(true);
    expect(result.gates?.length).toBe(1);
    // Final content is from the gates pass (last Claude edit)
    expect(result.updatedAgentContent).toBe("agent after gates mix");
  });

  test("gate extraction failure returns null gates", async () => {
    let callCount = 0;
    let fileContent = LOCAL_AGENT;
    // Mock that throws on the extraction call (fallthrough)
    const mock = async (args: string[]): Promise<string> => {
      callCount++;
      const prompt = args[args.indexOf("-p") + 1] ?? "";
      if (prompt.includes("augmenting a local agent's quality assurance")) {
        fileContent = "updated agent with gates";
        return ""; // stdout ignored for edit stages
      }
      // Extraction call — simulate Claude process failure
      throw new Error("claude exited with code 1");
    };
    const mockReadFile: FileReader = async () => fileContent;

    const result = await mix(
      {
        agentPath: AGENT_PATH,
        foreignAgentContent: FOREIGN_AGENT,
        mixPrinciples: false,
        mixGates: true,
        model: "opus",
        gatesModel: "sonnet",
        readOnlyTools: "Read Glob Grep",
      },
      mock,
      mockReadFile,
    );

    expect(callCount).toBe(2); // gates mix + failed extraction
    expect(result.gatesMixed).toBe(true);
    expect(result.gates).toBeNull();
    expect(result.updatedAgentContent).toBe("updated agent with gates");
  });

  test("malformed extraction output returns null gates", async () => {
    let callCount = 0;
    let fileContent = LOCAL_AGENT;
    const mock = async (args: string[]): Promise<string> => {
      callCount++;
      const prompt = args[args.indexOf("-p") + 1] ?? "";
      if (prompt.includes("augmenting a local agent's quality assurance")) {
        fileContent = "updated agent with gates";
        return ""; // stdout ignored for edit stages
      }
      // Extraction call — return non-JSON garbage
      return "Sure, here are the gates I found in the agent.";
    };
    const mockReadFile: FileReader = async () => fileContent;

    const result = await mix(
      {
        agentPath: AGENT_PATH,
        foreignAgentContent: FOREIGN_AGENT,
        mixPrinciples: false,
        mixGates: true,
        model: "opus",
        gatesModel: "sonnet",
        readOnlyTools: "Read Glob Grep",
      },
      mock,
      mockReadFile,
    );

    expect(callCount).toBe(2);
    expect(result.gatesMixed).toBe(true);
    expect(result.gates).toBeNull();
  });

  test("mix stages use readOnly: false", async () => {
    const argSets: string[][] = [];
    let fileContent = LOCAL_AGENT;
    const mock = createMixMock(
      { principles: "updated" },
      {
        onCall: (args) => {
          argSets.push([...args]);
        },
        onEdit: (content) => {
          fileContent = content;
        },
      },
    );
    const mockReadFile: FileReader = async () => fileContent;

    await mix(
      {
        agentPath: AGENT_PATH,
        foreignAgentContent: FOREIGN_AGENT,
        mixPrinciples: true,
        mixGates: false,
        model: "opus",
        gatesModel: "sonnet",
        readOnlyTools: "Read Glob Grep",
      },
      mock,
      mockReadFile,
    );

    // The principles call should NOT have --allowedTools (readOnly: false)
    expect(argSets[0]).not.toContain("--allowedTools");
  });

  test("gate extraction still uses readOnly: true", async () => {
    const argSets: string[][] = [];
    let fileContent = LOCAL_AGENT;
    const mock = createMixMock(
      {
        gates: "updated",
        gateExtraction: "[]",
      },
      {
        onCall: (args) => {
          argSets.push([...args]);
        },
        onEdit: (content) => {
          fileContent = content;
        },
      },
    );
    const mockReadFile: FileReader = async () => fileContent;

    await mix(
      {
        agentPath: AGENT_PATH,
        foreignAgentContent: FOREIGN_AGENT,
        mixPrinciples: false,
        mixGates: true,
        model: "opus",
        gatesModel: "sonnet",
        readOnlyTools: "Read Glob Grep",
      },
      mock,
      mockReadFile,
    );

    // Second call is gate extraction — should have --allowedTools (readOnly: true)
    expect(argSets[1]).toContain("--allowedTools");
  });
});
