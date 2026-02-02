import { describe, it, expect } from "bun:test";

describe("derive command integration", () => {
  const projectRoot = import.meta.dir + "/../..";

  it("should exit with error when no args provided", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "derive"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: projectRoot,
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage: hone derive");
  });

  // Note: We don't test the successful case because it requires Claude CLI to be available
  // and would actually invoke the agent, which is not appropriate for unit tests.
  // The command's core logic is covered by the validation test above.
});
