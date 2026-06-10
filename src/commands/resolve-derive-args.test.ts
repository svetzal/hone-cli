import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { CliError } from "../errors.ts";
import type { ParsedArgs } from "../types.ts";
import { resolveDeriveArgs } from "./resolve-derive-args.ts";

function makeParsed(positional: string[], flags: Record<string, string | boolean> = {}): ParsedArgs {
  return { command: "derive", positional, flags };
}

describe("resolveDeriveArgs", () => {
  it("throws CliError with usage message when no folder is provided", () => {
    expect(() => resolveDeriveArgs(makeParsed([]))).toThrow(CliError);
    expect(() => resolveDeriveArgs(makeParsed([]))).toThrow("Usage: hone derive");
  });

  it("resolves folder to absolute path", () => {
    const result = resolveDeriveArgs(makeParsed(["./some/path"]));
    expect(result.resolvedFolder).toBe(resolve("./some/path"));
  });

  it("sets isGlobal from --global flag", () => {
    expect(resolveDeriveArgs(makeParsed(["."], { global: true })).isGlobal).toBe(true);
    expect(resolveDeriveArgs(makeParsed(["."])).isGlobal).toBe(false);
  });

  it("sets isJson from --json flag", () => {
    expect(resolveDeriveArgs(makeParsed(["."], { json: true })).isJson).toBe(true);
    expect(resolveDeriveArgs(makeParsed(["."])).isJson).toBe(false);
  });

  it("maps --name flag to nameOverride", () => {
    expect(resolveDeriveArgs(makeParsed(["."], { name: "my-agent" })).nameOverride).toBe("my-agent");
    expect(resolveDeriveArgs(makeParsed(["."])).nameOverride).toBeUndefined();
  });

  it("ignores non-string --name values", () => {
    expect(resolveDeriveArgs(makeParsed(["."], { name: true })).nameOverride).toBeUndefined();
  });
});
