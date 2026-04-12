import { describe, expect, it } from "bun:test";

describe("resolveCommandArgs validation", () => {
  const projectRoot = `${import.meta.dir}/../..`;

  it("should exit with error and show usage when agent is missing", async () => {
    const proc = Bun.spawn([process.execPath, "run", "src/cli.ts", "iterate"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: projectRoot,
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
    expect(stderr).toContain("hone iterate");
  });

  it("should exit with error and show usage when folder is missing", async () => {
    const proc = Bun.spawn([process.execPath, "run", "src/cli.ts", "iterate", "some-agent"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: projectRoot,
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
  });

  it("should exit with error when agent not found", async () => {
    const proc = Bun.spawn([process.execPath, "run", "src/cli.ts", "iterate", "nonexistent-agent", "./src"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: projectRoot,
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });

  it("should exit with usage error for maintain when args missing", async () => {
    const proc = Bun.spawn([process.execPath, "run", "src/cli.ts", "maintain"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: projectRoot,
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
    expect(stderr).toContain("hone maintain");
  });

  it("should exit with error when agent not found for maintain", async () => {
    const proc = Bun.spawn([process.execPath, "run", "src/cli.ts", "maintain", "nonexistent-agent", "./src"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: projectRoot,
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });
});
