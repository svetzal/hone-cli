import { describe, it, expect } from "bun:test";

describe("config command integration", () => {
  const projectRoot = import.meta.dir + "/../..";

  it("should display current configuration", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "config"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: projectRoot,
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Current configuration");
  });

  it("should show default model names", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "config"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: projectRoot,
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("opus");
    expect(stdout).toContain("haiku");
    expect(stdout).toContain("sonnet");
  });

  it("should show config file path", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "config"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: projectRoot,
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Config file:");
  });
});
