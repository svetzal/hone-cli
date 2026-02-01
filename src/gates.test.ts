import { describe, expect, test } from "bun:test";
import { detectGates } from "./gates.ts";
import { join } from "path";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";

describe("detectGates", () => {
  test("detects npm gates from package.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      await writeFile(join(dir, "package.json"), "{}");
      const gates = await detectGates(dir);

      expect(gates.length).toBe(3);
      expect(gates[0]!.name).toBe("test");
      expect(gates[0]!.command).toBe("npm test");
      expect(gates[0]!.required).toBe(true);
      expect(gates[1]!.name).toBe("lint");
      expect(gates[2]!.name).toBe("security");
      expect(gates[2]!.required).toBe(false);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("detects mix gates from mix.exs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      await writeFile(join(dir, "mix.exs"), "");
      const gates = await detectGates(dir);

      expect(gates.length).toBe(3);
      expect(gates[0]!.name).toBe("test");
      expect(gates[0]!.command).toBe("mix test");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("detects python gates from pyproject.toml", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      await writeFile(join(dir, "pyproject.toml"), "");
      const gates = await detectGates(dir);

      expect(gates.length).toBe(3);
      expect(gates[0]!.name).toBe("test");
      expect(gates[0]!.command).toBe("pytest");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("uses .hone-gates.json override when present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      // Both files present — override wins
      await writeFile(join(dir, "package.json"), "{}");
      await writeFile(
        join(dir, ".hone-gates.json"),
        JSON.stringify({
          gates: [
            { name: "test", command: "bun test", required: true },
            { name: "typecheck", command: "bunx tsc --noEmit" },
          ],
        }),
      );
      const gates = await detectGates(dir);

      expect(gates.length).toBe(2);
      expect(gates[0]!.command).toBe("bun test");
      expect(gates[1]!.name).toBe("typecheck");
      expect(gates[1]!.required).toBe(true); // defaults to true
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("returns empty for unknown project types", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      const gates = await detectGates(dir);
      expect(gates.length).toBe(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
