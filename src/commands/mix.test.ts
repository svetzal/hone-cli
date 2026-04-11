import { describe, expect, test } from "bun:test";
import { mixCommand } from "./mix.ts";
import type { ParsedArgs } from "../types.ts";
import { CliError } from "../errors.ts";

describe("mixCommand", () => {
  describe("argument validation", () => {
    test("throws CliError with usage message when agent name is missing", async () => {
      const parsed: ParsedArgs = {
        command: "mix",
        positional: [],
        flags: { from: "foreign-agent", principles: true },
      };

      await expect(mixCommand(parsed)).rejects.toThrow(CliError);
      await expect(mixCommand(parsed)).rejects.toThrow("Usage: hone mix");
    });

    test("throws CliError when folder is missing", async () => {
      const parsed: ParsedArgs = {
        command: "mix",
        positional: ["my-agent"],
        flags: { from: "foreign-agent", principles: true },
      };

      await expect(mixCommand(parsed)).rejects.toThrow(CliError);
    });

    test("throws CliError when --from is missing", async () => {
      const parsed: ParsedArgs = {
        command: "mix",
        positional: ["my-agent", "."],
        flags: { principles: true },
      };

      await expect(mixCommand(parsed)).rejects.toThrow(CliError);
    });

    test("throws CliError when neither --principles nor --gates is set", async () => {
      const parsed: ParsedArgs = {
        command: "mix",
        positional: ["my-agent", "."],
        flags: { from: "foreign-agent" },
      };

      await expect(mixCommand(parsed)).rejects.toThrow(CliError);
      await expect(mixCommand(parsed)).rejects.toThrow(
        "Error: At least one of --principles or --gates is required.",
      );
    });

    test("throws CliError with usage message when --from is boolean (no value)", async () => {
      // When --from is parsed as a boolean flag (no value), foreignName is undefined
      const parsed: ParsedArgs = {
        command: "mix",
        positional: ["my-agent", "."],
        flags: { from: true, principles: true },
      };

      await expect(mixCommand(parsed)).rejects.toThrow(CliError);
      await expect(mixCommand(parsed)).rejects.toThrow("Usage: hone mix");
    });
  });
});
