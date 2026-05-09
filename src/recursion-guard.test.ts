import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { assertNotRecursive, nextDepthEnv } from "./recursion-guard.ts";

describe("nextDepthEnv", () => {
  it("increments from unset to 1", () => {
    const env = nextDepthEnv({});
    expect(env.HONE_AGENT_DEPTH).toBe("1");
  });

  it("increments from 0 to 1", () => {
    const env = nextDepthEnv({ HONE_AGENT_DEPTH: "0" });
    expect(env.HONE_AGENT_DEPTH).toBe("1");
  });

  it("increments from 1 to 2", () => {
    const env = nextDepthEnv({ HONE_AGENT_DEPTH: "1" });
    expect(env.HONE_AGENT_DEPTH).toBe("2");
  });

  it("increments from 3 to 4", () => {
    const env = nextDepthEnv({ HONE_AGENT_DEPTH: "3" });
    expect(env.HONE_AGENT_DEPTH).toBe("4");
  });

  it("treats non-numeric value as 0 and increments to 1", () => {
    const env = nextDepthEnv({ HONE_AGENT_DEPTH: "banana" });
    expect(env.HONE_AGENT_DEPTH).toBe("1");
  });

  it("preserves other env vars", () => {
    const env = nextDepthEnv({ HONE_AGENT_DEPTH: "1", MY_VAR: "hello" });
    expect(env.MY_VAR).toBe("hello");
    expect(env.HONE_AGENT_DEPTH).toBe("2");
  });
});

describe("assertNotRecursive", () => {
  const originalEnv = process.env.HONE_AGENT_DEPTH;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.HONE_AGENT_DEPTH;
    } else {
      process.env.HONE_AGENT_DEPTH = originalEnv;
    }
  });

  it("does nothing when HONE_AGENT_DEPTH is unset", () => {
    delete process.env.HONE_AGENT_DEPTH;
    // Should not throw or exit
    expect(() => assertNotRecursive("iterate")).not.toThrow();
  });

  it("does nothing when HONE_AGENT_DEPTH is 0", () => {
    process.env.HONE_AGENT_DEPTH = "0";
    expect(() => assertNotRecursive("iterate")).not.toThrow();
  });

  it("calls process.exit(2) when HONE_AGENT_DEPTH is 1", () => {
    process.env.HONE_AGENT_DEPTH = "1";
    const exitSpy = spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      expect(() => assertNotRecursive("iterate")).toThrow("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  it("calls process.exit(2) when HONE_AGENT_DEPTH is 5", () => {
    process.env.HONE_AGENT_DEPTH = "5";
    const exitSpy = spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      expect(() => assertNotRecursive("maintain")).toThrow("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  it("writes the command name and depth to stderr when refusing", () => {
    process.env.HONE_AGENT_DEPTH = "3";
    const stderrMessages: string[] = [];
    const exitSpy = spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation((msg) => {
      stderrMessages.push(String(msg));
      return true;
    });

    try {
      expect(() => assertNotRecursive("iterate")).toThrow();
      expect(stderrMessages.join("")).toContain("hone iterate");
      expect(stderrMessages.join("")).toContain("HONE_AGENT_DEPTH=3");
    } finally {
      exitSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  it("includes the command name in the stderr message for maintain", () => {
    process.env.HONE_AGENT_DEPTH = "2";
    const stderrMessages: string[] = [];
    const exitSpy = spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation((msg) => {
      stderrMessages.push(String(msg));
      return true;
    });

    try {
      expect(() => assertNotRecursive("maintain")).toThrow();
      expect(stderrMessages.join("")).toContain("hone maintain");
    } finally {
      exitSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });
});
