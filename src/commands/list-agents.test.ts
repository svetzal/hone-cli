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

  it("should output valid JSON array with --json flag", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "list-agents", "--json"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: projectRoot,
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);

    // Parse as JSON to verify it's valid
    const agents = JSON.parse(stdout);

    // Verify it's an array
    expect(Array.isArray(agents)).toBe(true);

    // If agents exist, verify structure
    if (agents.length > 0) {
      expect(agents[0]).toHaveProperty("name");
      expect(agents[0]).toHaveProperty("file");
    }
  });
});
