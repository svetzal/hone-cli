import { describe, expect, test } from "bun:test";
import { parseGatesJson, extractGatesFromAgentContent } from "./extract-gates.ts";
import type { ClaudeInvoker } from "./types.ts";

describe("parseGatesJson", () => {
  test("parses valid JSON array of gates", () => {
    const raw = JSON.stringify([
      { name: "test", command: "bun test", required: true },
      { name: "lint", command: "tsc --noEmit", required: true },
      { name: "security", command: "npm audit", required: false },
    ]);

    const gates = parseGatesJson(raw);

    expect(gates.length).toBe(3);
    expect(gates[0]).toEqual({ name: "test", command: "bun test", required: true });
    expect(gates[1]).toEqual({ name: "lint", command: "tsc --noEmit", required: true });
    expect(gates[2]).toEqual({ name: "security", command: "npm audit", required: false });
  });

  test("extracts JSON from surrounding text", () => {
    const raw = `Here are the gates:
[{"name": "test", "command": "pytest", "required": true}]
That's all.`;

    const gates = parseGatesJson(raw);

    expect(gates.length).toBe(1);
    expect(gates[0]).toEqual({ name: "test", command: "pytest", required: true });
  });

  test("defaults required to true when missing", () => {
    const raw = JSON.stringify([
      { name: "test", command: "bun test" },
    ]);

    const gates = parseGatesJson(raw);

    expect(gates.length).toBe(1);
    expect(gates[0]!.required).toBe(true);
  });

  test("returns empty array for invalid JSON", () => {
    expect(parseGatesJson("not json at all")).toEqual([]);
    expect(parseGatesJson("{not an array}")).toEqual([]);
    expect(parseGatesJson("")).toEqual([]);
  });

  test("filters out entries missing name or command", () => {
    const raw = JSON.stringify([
      { name: "test", command: "bun test" },
      { name: "missing-command" },
      { command: "missing-name" },
      { unrelated: true },
    ]);

    const gates = parseGatesJson(raw);

    expect(gates.length).toBe(1);
    expect(gates[0]!.name).toBe("test");
  });

  test("handles JSON with markdown code fences", () => {
    const raw = `\`\`\`json
[{"name": "test", "command": "mix test", "required": true}]
\`\`\``;

    const gates = parseGatesJson(raw);

    expect(gates.length).toBe(1);
    expect(gates[0]!.command).toBe("mix test");
  });
});

describe("extractGatesFromAgentContent", () => {
  test("returns parsed gates from mock Claude response", async () => {
    const mockClaude: ClaudeInvoker = async () => {
      return JSON.stringify([
        { name: "test", command: "bun test", required: true },
        { name: "lint", command: "tsc --noEmit", required: true },
      ]);
    };

    const gates = await extractGatesFromAgentContent(
      "# Agent\n## QA\nRun bun test and tsc --noEmit",
      "haiku",
      "Read Glob Grep",
      mockClaude,
    );

    expect(gates.length).toBe(2);
    expect(gates[0]!.name).toBe("test");
    expect(gates[1]!.name).toBe("lint");
  });

  test("returns empty array when Claude returns invalid JSON", async () => {
    const mockClaude: ClaudeInvoker = async () => "I don't know what gates to extract.";

    const gates = await extractGatesFromAgentContent(
      "# Agent with no QA section",
      "haiku",
      "Read Glob Grep",
      mockClaude,
    );

    expect(gates).toEqual([]);
  });

  test("returns empty array when Claude call fails", async () => {
    const mockClaude: ClaudeInvoker = async () => {
      throw new Error("Claude process crashed");
    };

    const gates = await extractGatesFromAgentContent(
      "# Agent content",
      "haiku",
      "Read Glob Grep",
      mockClaude,
    );

    expect(gates).toEqual([]);
  });
});
