import { describe, expect, it, spyOn } from "bun:test";
import * as readline from "node:readline";
import { promptChoice } from "./prompt.ts";

function fakeReadline(answer: string) {
  spyOn(readline, "createInterface").mockReturnValue({
    question: (_prompt: string, cb: (answer: string) => void) => cb(answer),
    close: () => {},
  } as unknown as readline.Interface);
  spyOn(process.stderr, "write").mockImplementation(() => true);
}

describe("promptChoice", () => {
  const choices = [
    { key: "a", label: "Option A" },
    { key: "b", label: "Option B" },
  ];

  it("should resolve to the matched key on exact input", async () => {
    fakeReadline("b");
    const result = await promptChoice("Pick one:", choices);
    expect(result).toBe("b");
  });

  it("should normalize whitespace and case", async () => {
    fakeReadline("  B  ");
    const result = await promptChoice("Pick one:", choices);
    expect(result).toBe("b");
  });

  it("should fall back to the first choice key when no match", async () => {
    fakeReadline("z");
    const result = await promptChoice("Pick one:", choices);
    expect(result).toBe("a");
  });

  it("should resolve to empty string when choices is empty and answer does not match", async () => {
    fakeReadline("z");
    const result = await promptChoice("Pick one:", []);
    expect(result).toBe("");
  });
});
