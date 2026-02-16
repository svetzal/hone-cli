import { describe, it, expect } from "bun:test";

describe("derive-gates command integration", () => {
  const projectRoot = import.meta.dir + "/../..";

  it("should exit with error when no args provided", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "derive-gates"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: projectRoot,
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage: hone derive-gates");
  });
});
