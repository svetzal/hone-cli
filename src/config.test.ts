import { describe, expect, test } from "bun:test";
import { getDefaultConfig } from "./config.ts";

describe("getDefaultConfig", () => {
  test("returns expected defaults", () => {
    const config = getDefaultConfig();

    expect(config.models.assess).toBe("opus");
    expect(config.models.name).toBe("haiku");
    expect(config.models.plan).toBe("opus");
    expect(config.models.execute).toBe("sonnet");
    expect(config.auditDir).toBe("audit");
    expect(config.maxRetries).toBe(3);
    expect(config.gateTimeout).toBe(120_000);
    expect(config.readOnlyTools).toBe("Read Glob Grep WebFetch WebSearch");
  });
});
