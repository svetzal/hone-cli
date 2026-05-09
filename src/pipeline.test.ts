import { describe, expect, test } from "bun:test";
import { buildExecutePrompt } from "./pipeline.ts";

describe("buildExecutePrompt", () => {
  test("starts with the role-clarification line", () => {
    const prompt = buildExecutePrompt("/my/project", "assessment text", "plan text");
    const firstLine = prompt.split("\n")[0];
    expect(firstLine).toBe("You are running inside a hone iterate run for the project at /my/project.");
  });

  test("contains do-not-invoke hone iterate instruction", () => {
    const prompt = buildExecutePrompt("/my/project", "assessment text", "plan text");
    expect(prompt).toContain("do not invoke `hone iterate`");
  });

  test("contains do-not-invoke hone maintain instruction", () => {
    const prompt = buildExecutePrompt("/my/project", "assessment text", "plan text");
    expect(prompt).toContain("`hone maintain`");
  });

  test("contains the assessment", () => {
    const prompt = buildExecutePrompt("/my/project", "assessment text", "plan text");
    expect(prompt).toContain("assessment text");
  });

  test("contains the plan", () => {
    const prompt = buildExecutePrompt("/my/project", "assessment text", "plan text");
    expect(prompt).toContain("plan text");
  });

  test("contains the folder path in the execute instruction", () => {
    const prompt = buildExecutePrompt("/specific/folder", "assessment", "plan");
    expect(prompt).toContain("/specific/folder");
  });
});
