import { describe, expect, it, spyOn } from "bun:test";
import { createProgressCallback, progress, reportGateValidation, writeJson } from "./output";
import type { GateResult } from "./types.ts";

describe("output utilities", () => {
  describe("writeJson", () => {
    it("should write JSON to stdout", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      const data = { foo: "bar", baz: 42 };
      writeJson(data);

      expect(logSpy).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
      logSpy.mockRestore();
    });

    it("should handle arrays", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      const data = [{ name: "test" }, { name: "other" }];
      writeJson(data);

      expect(logSpy).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
      logSpy.mockRestore();
    });

    it("should handle null and undefined", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      writeJson(null);
      expect(logSpy).toHaveBeenCalledWith("null");

      writeJson(undefined);
      expect(logSpy).toHaveBeenCalledWith(undefined);

      logSpy.mockRestore();
    });
  });

  describe("progress", () => {
    it("should write to stdout when json=false", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});

      progress(false, "Test message");

      expect(logSpy).toHaveBeenCalledWith("Test message");
      expect(errorSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("should write to stderr when json=true", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});

      progress(true, "Test message");

      expect(errorSpy).toHaveBeenCalledWith("Test message");
      expect(logSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe("createProgressCallback", () => {
    it("should write formatted message to stdout when json=false", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});

      const onProgress = createProgressCallback(false);
      onProgress("assess", "Evaluating codebase...");

      expect(logSpy).toHaveBeenCalledWith("==> [assess] Evaluating codebase...");
      expect(errorSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("should write formatted message to stderr when json=true", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});

      const onProgress = createProgressCallback(true);
      onProgress("execute", "Applying changes...");

      expect(errorSpy).toHaveBeenCalledWith("==> [execute] Applying changes...");
      expect(logSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe("reportGateValidation", () => {
    const makeResult = (name: string, command: string, passed: boolean): GateResult => ({
      name,
      command,
      passed,
      required: true,
      output: "",
      exitCode: passed ? 0 : 1,
    });

    it("should report all gates as pass when all gates pass", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});

      const results: GateResult[] = [
        makeResult("test", "bun test", true),
        makeResult("typecheck", "bunx tsc --noEmit", true),
      ];

      reportGateValidation(results, true, false);

      expect(logSpy).toHaveBeenCalledWith("  pass: test (bun test)");
      expect(logSpy).toHaveBeenCalledWith("  pass: typecheck (bunx tsc --noEmit)");
      expect(logSpy).not.toHaveBeenCalledWith("Some gates failed. Review and fix before running hone iterate.");
      expect(errorSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("should report failed gates as FAIL and print the warning message", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});

      const results: GateResult[] = [makeResult("test", "bun test", true), makeResult("lint", "bun run lint", false)];

      reportGateValidation(results, false, false);

      expect(logSpy).toHaveBeenCalledWith("  pass: test (bun test)");
      expect(logSpy).toHaveBeenCalledWith("  FAIL: lint (bun run lint)");
      expect(logSpy).toHaveBeenCalledWith("Some gates failed. Review and fix before running hone iterate.");

      logSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("should write to stderr in json mode", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});

      const results: GateResult[] = [makeResult("test", "bun test", false)];

      reportGateValidation(results, false, true);

      expect(errorSpy).toHaveBeenCalledWith("  FAIL: test (bun test)");
      expect(errorSpy).toHaveBeenCalledWith("Some gates failed. Review and fix before running hone iterate.");
      expect(logSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });
});
