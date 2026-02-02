import { describe, it, expect } from "bun:test";

describe("list-agents command integration", () => {
  const projectRoot = import.meta.dir + "/../..";

  it("should list available agents or show no agents message", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "list-agents"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: projectRoot,
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    // Either shows agents or "No agents found" depending on system state
    const hasAgents = stdout.includes("Available agents") || stdout.includes("No agents found");
    expect(hasAgents).toBe(true);
  });
});
