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
    expect(config.models.gates).toBe("sonnet");
    expect(config.models.derive).toBe("opus");
    expect(config.models.triage).toBe("haiku");
    expect(config.models.mix).toBe("opus");
    expect(config.models.summarize).toBe("haiku");
    expect(config.auditDir).toBe("audit");
    expect(config.maxRetries).toBe(3);
    expect(config.gateTimeout).toBe(120_000);
    expect(config.readOnlyTools).toBe("Read Glob Grep WebFetch WebSearch");
    expect(config.mode).toBe("local");
    expect(config.minCharterLength).toBe(100);
    expect(config.severityThreshold).toBe(3);
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

  test("overrides mode to github", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      const configPath = join(dir, "config.json");
      await writeFile(
        configPath,
        JSON.stringify({ mode: "github" }),
      );

      const config = await loadConfig(configPath);

      expect(config.mode).toBe("github");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("overrides severityThreshold and minCharterLength", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      const configPath = join(dir, "config.json");
      await writeFile(
        configPath,
        JSON.stringify({
          severityThreshold: 4,
          minCharterLength: 200,
        }),
      );

      const config = await loadConfig(configPath);

      expect(config.severityThreshold).toBe(4);
      expect(config.minCharterLength).toBe(200);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("overrides auditDir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      const configPath = join(dir, "config.json");
      await writeFile(
        configPath,
        JSON.stringify({ auditDir: "/custom/audit" }),
      );

      const config = await loadConfig(configPath);

      expect(config.auditDir).toBe("/custom/audit");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("overrides readOnlyTools", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      const configPath = join(dir, "config.json");
      await writeFile(
        configPath,
        JSON.stringify({ readOnlyTools: "Read Glob" }),
      );

      const config = await loadConfig(configPath);

      expect(config.readOnlyTools).toBe("Read Glob");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("full config override preserves all fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      const configPath = join(dir, "config.json");
      const fullOverride = {
        models: {
          assess: "sonnet",
          name: "sonnet",
          plan: "sonnet",
          execute: "haiku",
          gates: "haiku",
          derive: "sonnet",
          triage: "sonnet",
          mix: "sonnet",
          summarize: "sonnet",
        },
        auditDir: "custom-audit",
        readOnlyTools: "Read",
        maxRetries: 10,
        gateTimeout: 60000,
        mode: "github",
        minCharterLength: 50,
        severityThreshold: 1,
      };
      await writeFile(configPath, JSON.stringify(fullOverride));

      const config = await loadConfig(configPath);

      expect(config.models.assess).toBe("sonnet");
      expect(config.models.execute).toBe("haiku");
      expect(config.auditDir).toBe("custom-audit");
      expect(config.readOnlyTools).toBe("Read");
      expect(config.maxRetries).toBe(10);
      expect(config.gateTimeout).toBe(60000);
      expect(config.mode).toBe("github");
      expect(config.minCharterLength).toBe(50);
      expect(config.severityThreshold).toBe(1);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
