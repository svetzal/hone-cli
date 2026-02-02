import { describe, expect, test } from "bun:test";
import { extractPrompt, createIterateMock, createDeriveMock } from "./test-helpers.ts";

describe("extractPrompt", () => {
  test("extracts prompt after -p flag", () => {
    expect(extractPrompt(["--model", "opus", "-p", "hello world"])).toBe("hello world");
  });

  test("returns empty string when -p is absent", () => {
    expect(extractPrompt(["--model", "opus"])).toBe("");
  });

  test("returns empty string when -p is last element", () => {
    expect(extractPrompt(["--model", "opus", "-p"])).toBe("");
  });
});

describe("createIterateMock", () => {
  test("dispatches assess stage", async () => {
    const mock = createIterateMock({
      assess: "assessment result",
      name: "name result",
      plan: "plan result",
      execute: "execute result",
    });
    const result = await mock(["--model", "opus", "-p", "Assess the project..."]);
    expect(result).toBe("assessment result");
  });

  test("dispatches name stage", async () => {
    const mock = createIterateMock({
      assess: "a", name: "name result", plan: "p", execute: "e",
    });
    const result = await mock(["-p", "Output ONLY a short kebab-case..."]);
    expect(result).toBe("name result");
  });

  test("dispatches plan stage", async () => {
    const mock = createIterateMock({
      assess: "a", name: "n", plan: "plan result", execute: "e",
    });
    const result = await mock(["-p", "Based on the following assessment..."]);
    expect(result).toBe("plan result");
  });

  test("dispatches execute stage", async () => {
    const mock = createIterateMock({
      assess: "a", name: "n", plan: "p", execute: "execute result",
    });
    const result = await mock(["-p", "Execute the following plan..."]);
    expect(result).toBe("execute result");
  });

  test("dispatches retry as execute stage", async () => {
    const mock = createIterateMock({
      assess: "a", name: "n", plan: "p", execute: "retry result",
    });
    const result = await mock(["-p", "The previous execution introduced..."]);
    expect(result).toBe("retry result");
  });

  test("calls onCall callback with args", async () => {
    const calls: string[][] = [];
    const mock = createIterateMock(
      { assess: "a", name: "n", plan: "p", execute: "e" },
      { onCall: (args) => calls.push(args) },
    );
    await mock(["-p", "Assess..."]);
    expect(calls.length).toBe(1);
  });
});

describe("createDeriveMock", () => {
  test("dispatches derive call", async () => {
    const mock = createDeriveMock({
      derive: "agent content",
      gateExtraction: "[]",
    });
    const result = await mock(["-p", "You are inspecting a software project..."]);
    expect(result).toBe("agent content");
  });

  test("dispatches gate extraction call", async () => {
    const mock = createDeriveMock({
      derive: "agent content",
      gateExtraction: '[{"name":"test","command":"bun test","required":true}]',
    });
    const result = await mock(["-p", "Extract gates from..."]);
    expect(result).toBe('[{"name":"test","command":"bun test","required":true}]');
  });
});
