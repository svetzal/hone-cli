import { describe, it, expect, mock, spyOn } from "bun:test";
import { writeJson, progress } from "./output";

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
});
