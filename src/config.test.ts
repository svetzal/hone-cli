import { describe, expect, test } from "bun:test";
import { getDefaultConfig, loadConfig } from "./config.ts";
import { join } from "path";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";

describe("getDefaultConfig", () => {
  test("returns expected defaults", () => {
    const config = getDefaultConfig();

    expect(config.models.assess).toBe("opus");
    expect(config.models.name).toBe("haiku");
    expect(config.models.plan).toBe("opus");
    expect(config.models.execute).toBe("sonnet");
    expect(config.models.gates).toBe("haiku");
    expect(config.models.derive).toBe("sonnet");
    expect(config.auditDir).toBe("audit");
    expect(config.maxRetries).toBe(3);
    expect(config.gateTimeout).toBe(120_000);
    expect(config.readOnlyTools).toBe("Read Glob Grep WebFetch WebSearch");
  });
});

describe("loadConfig", () => {
  test("returns defaults when config file does not exist", async () => {
    const nonExistentPath = `/tmp/nonexistent-config-${Date.now()}.json`;
    const config = await loadConfig(nonExistentPath);

    const defaults = getDefaultConfig();
    expect(config).toEqual(defaults);
  });

  test("merges partial model overrides with defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      const configPath = join(dir, "config.json");
      await writeFile(
        configPath,
        JSON.stringify({
          models: {
            assess: "sonnet",
          },
        }),
      );

      const config = await loadConfig(configPath);

      expect(config.models.assess).toBe("sonnet");
      expect(config.models.plan).toBe("opus"); // Default preserved
      expect(config.models.execute).toBe("sonnet"); // Default preserved
      expect(config.models.name).toBe("haiku"); // Default preserved
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("overrides non-model fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      const configPath = join(dir, "config.json");
      await writeFile(
        configPath,
        JSON.stringify({
          maxRetries: 5,
          gateTimeout: 60000,
        }),
      );

      const config = await loadConfig(configPath);

      expect(config.maxRetries).toBe(5);
      expect(config.gateTimeout).toBe(60000);

      // Models should be defaults (untouched)
      const defaults = getDefaultConfig();
      expect(config.models).toEqual(defaults.models);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("respects falsy values like maxRetries: 0", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      const configPath = join(dir, "config.json");
      await writeFile(
        configPath,
        JSON.stringify({
          maxRetries: 0,
        }),
      );

      const config = await loadConfig(configPath);

      expect(config.maxRetries).toBe(0); // Not the default 3
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("returns defaults for invalid JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      const configPath = join(dir, "config.json");
      await writeFile(configPath, "not valid json {{{");

      const config = await loadConfig(configPath);

      const defaults = getDefaultConfig();
      expect(config).toEqual(defaults);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
