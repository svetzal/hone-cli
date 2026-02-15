import { describe, expect, test } from "bun:test";
import { mix, buildPrinciplesMixPrompt, buildGatesMixPrompt } from "./mix.ts";
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

describe("buildPrinciplesMixPrompt", () => {
  test("includes both agent contents", () => {
    const prompt = buildPrinciplesMixPrompt(LOCAL_AGENT, FOREIGN_AGENT);
    expect(prompt).toContain(LOCAL_AGENT);
    expect(prompt).toContain(FOREIGN_AGENT);
  });

  test("instructs to only modify principles", () => {
    const prompt = buildPrinciplesMixPrompt(LOCAL_AGENT, FOREIGN_AGENT);
    expect(prompt).toContain("ONLY modify sections related to engineering principles");
  });

  test("forbids touching gates", () => {
    const prompt = buildPrinciplesMixPrompt(LOCAL_AGENT, FOREIGN_AGENT);
    expect(prompt).toContain("DO NOT touch QA checkpoints");
  });
});

describe("buildGatesMixPrompt", () => {
  test("includes both agent contents", () => {
    const prompt = buildGatesMixPrompt(LOCAL_AGENT, FOREIGN_AGENT);
    expect(prompt).toContain(LOCAL_AGENT);
    expect(prompt).toContain(FOREIGN_AGENT);
  });

  test("instructs to only modify gates", () => {
    const prompt = buildGatesMixPrompt(LOCAL_AGENT, FOREIGN_AGENT);
    expect(prompt).toContain("ONLY modify sections related to QA checkpoints");
  });

  test("forbids touching principles", () => {
    const prompt = buildGatesMixPrompt(LOCAL_AGENT, FOREIGN_AGENT);
    expect(prompt).toContain("DO NOT touch engineering principles");
  });
});

describe("mix", () => {
  test("principles-only: 1 Claude call, no gate extraction", async () => {
    let callCount = 0;
    const mock = createMixMock(
      { principles: "updated agent with principles" },
      { onCall: () => { callCount++; } },
    );

    const result = await mix({
      localAgentContent: LOCAL_AGENT,
      foreignAgentContent: FOREIGN_AGENT,
      mixPrinciples: true,
      mixGates: false,
      model: "opus",
      gatesModel: "sonnet",
      readOnlyTools: "Read Glob Grep",
    }, mock);

    expect(callCount).toBe(1);
    expect(result.principlesMixed).toBe(true);
    expect(result.gatesMixed).toBe(false);
    expect(result.gates).toBeNull();
    expect(result.updatedAgentContent).toBe("updated agent with principles");
  });

  test("gates-only: 1 Claude call + 1 gate extraction call", async () => {
    let callCount = 0;
    const mock = createMixMock(
      {
        gates: "updated agent with gates",
        gateExtraction: JSON.stringify([
          { name: "test", command: "bun test", required: true },
          { name: "typecheck", command: "bunx tsc --noEmit", required: true },
        ]),
      },
      { onCall: () => { callCount++; } },
    );

    const result = await mix({
      localAgentContent: LOCAL_AGENT,
      foreignAgentContent: FOREIGN_AGENT,
      mixPrinciples: false,
      mixGates: true,
      model: "opus",
      gatesModel: "sonnet",
      readOnlyTools: "Read Glob Grep",
    }, mock);

    expect(callCount).toBe(2); // gates mix + gate extraction
    expect(result.principlesMixed).toBe(false);
    expect(result.gatesMixed).toBe(true);
    expect(result.gates).not.toBeNull();
    expect(result.gates!.length).toBe(2);
    expect(result.updatedAgentContent).toBe("updated agent with gates");
  });

  test("both flags: 2 Claude calls + 1 gate extraction, in correct order", async () => {
    const prompts: string[] = [];
    const mock = createMixMock(
      {
        principles: "agent after principles mix",
        gates: "agent after gates mix",
        gateExtraction: JSON.stringify([
          { name: "test", command: "bun test", required: true },
        ]),
      },
      {
        onCall: (args) => {
          prompts.push(extractPrompt(args));
        },
      },
    );

    const result = await mix({
      localAgentContent: LOCAL_AGENT,
      foreignAgentContent: FOREIGN_AGENT,
      mixPrinciples: true,
      mixGates: true,
      model: "opus",
      gatesModel: "sonnet",
      readOnlyTools: "Read Glob Grep",
    }, mock);

    expect(prompts.length).toBe(3); // principles + gates + gate extraction
    expect(prompts[0]).toContain("engineering principles");
    expect(prompts[1]).toContain("quality assurance");
    expect(result.principlesMixed).toBe(true);
    expect(result.gatesMixed).toBe(true);
    expect(result.gates!.length).toBe(1);
    // Final content is from the gates pass (last Claude call)
    expect(result.updatedAgentContent).toBe("agent after gates mix");
  });

  test("gate extraction failure returns null gates", async () => {
    let callCount = 0;
    // Mock that throws on the extraction call (fallthrough)
    const mock = async (args: string[]): Promise<string> => {
      callCount++;
      const prompt = args[args.indexOf("-p") + 1] ?? "";
      if (prompt.includes("augmenting a LOCAL agent's quality assurance")) {
        return "updated agent with gates";
      }
      // Extraction call — simulate Claude process failure
      throw new Error("claude exited with code 1");
    };

    const result = await mix({
      localAgentContent: LOCAL_AGENT,
      foreignAgentContent: FOREIGN_AGENT,
      mixPrinciples: false,
      mixGates: true,
      model: "opus",
      gatesModel: "sonnet",
      readOnlyTools: "Read Glob Grep",
    }, mock);

    expect(callCount).toBe(2); // gates mix + failed extraction
    expect(result.gatesMixed).toBe(true);
    expect(result.gates).toBeNull();
    expect(result.updatedAgentContent).toBe("updated agent with gates");
  });

  test("malformed extraction output returns null gates", async () => {
    let callCount = 0;
    const mock = async (args: string[]): Promise<string> => {
      callCount++;
      const prompt = args[args.indexOf("-p") + 1] ?? "";
      if (prompt.includes("augmenting a LOCAL agent's quality assurance")) {
        return "updated agent with gates";
      }
      // Extraction call — return non-JSON garbage
      return "Sure, here are the gates I found in the agent.";
    };

    const result = await mix({
      localAgentContent: LOCAL_AGENT,
      foreignAgentContent: FOREIGN_AGENT,
      mixPrinciples: false,
      mixGates: true,
      model: "opus",
      gatesModel: "sonnet",
      readOnlyTools: "Read Glob Grep",
    }, mock);

    expect(callCount).toBe(2);
    expect(result.gatesMixed).toBe(true);
    expect(result.gates).toBeNull();
  });

  test("gates prompt sees principles-updated content when both flags set", async () => {
    const prompts: string[] = [];
    const mock = createMixMock(
      {
        principles: "PRINCIPLES-UPDATED-CONTENT",
        gates: "final content",
        gateExtraction: "[]",
      },
      {
        onCall: (args) => {
          prompts.push(extractPrompt(args));
        },
      },
    );

    await mix({
      localAgentContent: LOCAL_AGENT,
      foreignAgentContent: FOREIGN_AGENT,
      mixPrinciples: true,
      mixGates: true,
      model: "opus",
      gatesModel: "sonnet",
      readOnlyTools: "Read Glob Grep",
    }, mock);

    // The gates prompt (second call) should contain the principles-updated content
    expect(prompts[1]).toContain("PRINCIPLES-UPDATED-CONTENT");
  });
});
