import { describe, expect, test, spyOn } from "bun:test";
import { mixCommand } from "./mix.ts";
import type { ParsedArgs } from "../types.ts";

describe("mixCommand", () => {
  describe("argument validation", () => {
    test("exits with error when agent name is missing", async () => {
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      const exitSpy = spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      const parsed: ParsedArgs = {
        command: "mix",
        positional: [],
        flags: { from: "foreign-agent", principles: true },
      };

      await expect(mixCommand(parsed)).rejects.toThrow("process.exit called");
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Usage: hone mix"));

      errorSpy.mockRestore();
      exitSpy.mockRestore();
    });

    test("exits with error when folder is missing", async () => {
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      const exitSpy = spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      const parsed: ParsedArgs = {
        command: "mix",
        positional: ["my-agent"],
        flags: { from: "foreign-agent", principles: true },
      };

      await expect(mixCommand(parsed)).rejects.toThrow("process.exit called");

      errorSpy.mockRestore();
      exitSpy.mockRestore();
    });

    test("exits with error when --from is missing", async () => {
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      const exitSpy = spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      const parsed: ParsedArgs = {
        command: "mix",
        positional: ["my-agent", "."],
        flags: { principles: true },
      };

      await expect(mixCommand(parsed)).rejects.toThrow("process.exit called");

      errorSpy.mockRestore();
      exitSpy.mockRestore();
    });

    test("exits with error when neither --principles nor --gates is set", async () => {
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      const exitSpy = spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      const parsed: ParsedArgs = {
        command: "mix",
        positional: ["my-agent", "."],
        flags: { from: "foreign-agent" },
      };

      await expect(mixCommand(parsed)).rejects.toThrow("process.exit called");
      expect(errorSpy).toHaveBeenCalledWith(
        "Error: At least one of --principles or --gates is required.",
      );

      errorSpy.mockRestore();
      exitSpy.mockRestore();
    });

    test("treats --from as boolean when no value follows", async () => {
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      const exitSpy = spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      // When --from is parsed as a boolean flag (no value), foreignName is undefined
      const parsed: ParsedArgs = {
        command: "mix",
        positional: ["my-agent", "."],
        flags: { from: true, principles: true },
      };

      await expect(mixCommand(parsed)).rejects.toThrow("process.exit called");
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Usage: hone mix"));

      errorSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });
});
