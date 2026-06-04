import { describe, expect, it } from "bun:test";
import { getDefaultConfig } from "../config.ts";
import { buildPipelineContext } from "./build-pipeline-context.ts";

describe("buildPipelineContext", () => {
  const agent = "typescript-craftsperson";
  const folder = "/tmp/test-project";
  const config = getDefaultConfig();

  it("should pass agent, folder, and config through unchanged", () => {
    const ctx = buildPipelineContext(agent, folder, config, false);
    expect(ctx.agent).toBe(agent);
    expect(ctx.folder).toBe(folder);
    expect(ctx.config).toBe(config);
  });

  it("should wire a claude invoker function", () => {
    const ctx = buildPipelineContext(agent, folder, config, false);
    expect(typeof ctx.claude).toBe("function");
  });

  it("should wire an onProgress callback function", () => {
    const ctx = buildPipelineContext(agent, folder, config, false);
    expect(typeof ctx.onProgress).toBe("function");
  });
});
