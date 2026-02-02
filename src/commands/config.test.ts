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

  it("should output valid JSON with --json flag", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "config", "--json"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: projectRoot,
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);

    // Parse as JSON to verify it's valid
    const config = JSON.parse(stdout);

    // Verify structure
    expect(config).toHaveProperty("models");
    expect(config.models).toHaveProperty("assess");
    expect(config.models).toHaveProperty("name");
    expect(config.models).toHaveProperty("plan");
    expect(config.models).toHaveProperty("execute");
    expect(config).toHaveProperty("auditDir");
    expect(config).toHaveProperty("readOnlyTools");
    expect(config).toHaveProperty("maxRetries");
    expect(config).toHaveProperty("gateTimeout");
  });
});
