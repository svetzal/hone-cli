import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatesFilePath, readGatesFile, validateGateArray, writeGatesFile } from "./gates-file.ts";
import type { GateDefinition } from "./types.ts";

describe("gatesFilePath", () => {
  it("should return the expected path by joining projectDir with .hone-gates.json", () => {
    const result = gatesFilePath("/some/project");
    expect(result).toBe("/some/project/.hone-gates.json");
  });

  it("should handle trailing slashes in projectDir", () => {
    const result = gatesFilePath("/some/project/");
    expect(result).toBe("/some/project/.hone-gates.json");
  });
});

describe("writeGatesFile", () => {
  it("should write the correct JSON structure to disk and return the path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-gates-test-"));
    try {
      const gates: GateDefinition[] = [
        { name: "test", command: "bun test", required: true },
        { name: "typecheck", command: "bunx tsc --noEmit", required: false },
      ];

      const result = await writeGatesFile(dir, gates);

      expect(result).toBe(join(dir, ".hone-gates.json"));

      const content = await Bun.file(join(dir, ".hone-gates.json")).text();
      expect(content).toBe(`${JSON.stringify({ gates }, null, 2)}\n`);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("should write an empty gates array correctly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-gates-test-"));
    try {
      const result = await writeGatesFile(dir, []);

      expect(result).toBe(join(dir, ".hone-gates.json"));

      const content = await Bun.file(join(dir, ".hone-gates.json")).text();
      expect(content).toBe(`${JSON.stringify({ gates: [] }, null, 2)}\n`);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe("readGatesFile", () => {
  it("should return gates from a valid .hone-gates.json file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-gates-test-"));
    try {
      await writeFile(
        join(dir, ".hone-gates.json"),
        JSON.stringify({
          gates: [
            { name: "test", command: "bun test", required: true },
            { name: "lint", command: "bun run lint", required: false },
          ],
        }),
      );

      const gates = await readGatesFile(dir);

      expect(gates).not.toBeNull();
      expect(gates?.length).toBe(2);
      expect(gates?.[0]).toEqual({ name: "test", command: "bun test", required: true });
      expect(gates?.[1]).toEqual({ name: "lint", command: "bun run lint", required: false });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("should default required to true when not specified", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-gates-test-"));
    try {
      await writeFile(
        join(dir, ".hone-gates.json"),
        JSON.stringify({
          gates: [{ name: "typecheck", command: "bunx tsc --noEmit" }],
        }),
      );

      const gates = await readGatesFile(dir);

      expect(gates).not.toBeNull();
      expect(gates?.[0]?.required).toBe(true);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("should preserve explicit required: false", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-gates-test-"));
    try {
      await writeFile(
        join(dir, ".hone-gates.json"),
        JSON.stringify({
          gates: [{ name: "security", command: "osv-scanner .", required: false }],
        }),
      );

      const gates = await readGatesFile(dir);

      expect(gates).not.toBeNull();
      expect(gates?.[0]?.required).toBe(false);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("should return null when file does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-gates-test-"));
    try {
      const gates = await readGatesFile(dir);
      expect(gates).toBeNull();
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("should return null for invalid JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-gates-test-"));
    try {
      await writeFile(join(dir, ".hone-gates.json"), "not valid json {{{");

      const gates = await readGatesFile(dir);
      expect(gates).toBeNull();
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("should preserve timeout when specified", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-gates-test-"));
    try {
      await writeFile(
        join(dir, ".hone-gates.json"),
        JSON.stringify({
          gates: [{ name: "coverage", command: "make coverage", required: true, timeout: 300000 }],
        }),
      );

      const gates = await readGatesFile(dir);

      expect(gates).not.toBeNull();
      expect(gates?.[0]?.timeout).toBe(300000);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("should omit timeout when not specified in JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-gates-test-"));
    try {
      await writeFile(
        join(dir, ".hone-gates.json"),
        JSON.stringify({
          gates: [{ name: "test", command: "bun test", required: true }],
        }),
      );

      const gates = await readGatesFile(dir);

      expect(gates).not.toBeNull();
      expect(gates?.[0]).not.toHaveProperty("timeout");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("should return empty array when gates is not an array", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-gates-test-"));
    try {
      await writeFile(join(dir, ".hone-gates.json"), JSON.stringify({ gates: "not-an-array" }));

      const gates = await readGatesFile(dir);

      expect(gates).toEqual([]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe("validateGateArray", () => {
  it("returns [] when passed null", () => {
    expect(validateGateArray(null)).toEqual([]);
  });

  it("returns [] when passed a primitive", () => {
    expect(validateGateArray(42)).toEqual([]);
    expect(validateGateArray("gates")).toEqual([]);
  });

  it("returns [] when passed an array directly (not wrapped object)", () => {
    expect(validateGateArray([])).toEqual([]);
  });

  it("returns [] when the object has no gates key", () => {
    expect(validateGateArray({ other: [] })).toEqual([]);
  });

  it("returns [] when gates is not an array", () => {
    expect(validateGateArray({ gates: "not-an-array" })).toEqual([]);
  });

  it("filters out gate objects missing name", () => {
    const result = validateGateArray({
      gates: [
        { command: "bun test", required: true },
        { name: "lint", command: "bun run lint", required: true },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("lint");
  });

  it("filters out gate objects missing command", () => {
    const result = validateGateArray({
      gates: [
        { name: "test", required: true },
        { name: "lint", command: "bun run lint", required: true },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("lint");
  });

  it("returns valid gates alongside filtered-out invalid ones", () => {
    const result = validateGateArray({
      gates: [
        { name: "test", command: "bun test", required: true },
        { name: 42, command: "bad", required: true },
        { name: "lint", command: "bun run lint" },
      ],
    });
    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe("test");
    expect(result[1]?.name).toBe("lint");
    expect(result[1]?.required).toBe(true);
  });

  it("includes timeout when it is a number", () => {
    const result = validateGateArray({
      gates: [{ name: "slow", command: "make test", required: true, timeout: 300000 }],
    });
    expect(result[0]?.timeout).toBe(300000);
  });

  it("omits timeout when it is not a number", () => {
    const result = validateGateArray({
      gates: [{ name: "test", command: "bun test", required: true, timeout: "long" }],
    });
    expect(result[0]).not.toHaveProperty("timeout");
  });
});
