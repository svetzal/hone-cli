import { describe, expect, test } from "bun:test";
import type { ProjectContext } from "./derive.ts";
import { renderProjectContextSections } from "./prompt-context.ts";

const emptyContext: ProjectContext = {
  directoryTree: "",
  packageFiles: [],
  ciConfigs: [],
  toolConfigs: [],
  shellScripts: [],
  lockfiles: [],
};

describe("renderProjectContextSections", () => {
  test("renders project location heading with folder path", () => {
    const sections = renderProjectContextSections("/my/project", emptyContext);
    const output = sections.join("\n");

    expect(output).toContain("## Project Location");
    expect(output).toContain("The project is at: /my/project");
  });

  test("renders directory tree in fenced code block", () => {
    const context: ProjectContext = { ...emptyContext, directoryTree: "src/\n  index.ts" };
    const sections = renderProjectContextSections("/project", context);
    const output = sections.join("\n");

    expect(output).toContain("## Project Structure");
    expect(output).toContain("```\nsrc/\n  index.ts\n```");
  });

  test("renders (empty) for missing directory tree", () => {
    const sections = renderProjectContextSections("/project", emptyContext);
    const output = sections.join("\n");

    expect(output).toContain("(empty)");
  });

  test("renders package files when present", () => {
    const context: ProjectContext = { ...emptyContext, packageFiles: ["package.json", "Cargo.toml"] };
    const sections = renderProjectContextSections("/project", context);
    const output = sections.join("\n");

    expect(output).toContain("## Package/Build Files Found");
    expect(output).toContain("- package.json");
    expect(output).toContain("- Cargo.toml");
  });

  test("omits package files section when empty", () => {
    const sections = renderProjectContextSections("/project", emptyContext);
    const output = sections.join("\n");

    expect(output).not.toContain("Package/Build Files Found");
  });

  test("renders CI configs when present", () => {
    const context: ProjectContext = { ...emptyContext, ciConfigs: [".github/workflows/ci.yml"] };
    const sections = renderProjectContextSections("/project", context);
    const output = sections.join("\n");

    expect(output).toContain("## CI Configuration Files Found");
    expect(output).toContain("- .github/workflows/ci.yml");
  });

  test("omits CI configs section when empty", () => {
    const sections = renderProjectContextSections("/project", emptyContext);
    const output = sections.join("\n");

    expect(output).not.toContain("CI Configuration Files Found");
  });

  test("renders tool configs when present", () => {
    const context: ProjectContext = { ...emptyContext, toolConfigs: ["tsconfig.json", "biome.json"] };
    const sections = renderProjectContextSections("/project", context);
    const output = sections.join("\n");

    expect(output).toContain("## Tool Configuration Files Found");
    expect(output).toContain("- tsconfig.json");
    expect(output).toContain("- biome.json");
  });

  test("omits tool configs section when empty", () => {
    const sections = renderProjectContextSections("/project", emptyContext);
    const output = sections.join("\n");

    expect(output).not.toContain("Tool Configuration Files Found");
  });

  test("renders shell scripts when present", () => {
    const context: ProjectContext = { ...emptyContext, shellScripts: ["run-tests.sh", "lint.sh"] };
    const sections = renderProjectContextSections("/project", context);
    const output = sections.join("\n");

    expect(output).toContain("## Shell Scripts Found (project root)");
    expect(output).toContain("- run-tests.sh");
    expect(output).toContain("- lint.sh");
  });

  test("omits shell scripts section when empty", () => {
    const sections = renderProjectContextSections("/project", emptyContext);
    const output = sections.join("\n");

    expect(output).not.toContain("Shell Scripts Found");
  });

  test("renders lockfiles when present", () => {
    const context: ProjectContext = {
      ...emptyContext,
      lockfiles: [{ file: "bun.lockb", packageManager: "bun" }],
    };
    const sections = renderProjectContextSections("/project", context);
    const output = sections.join("\n");

    expect(output).toContain("## Lockfiles Detected");
    expect(output).toContain("- bun.lockb (bun)");
  });

  test("omits lockfiles section when empty", () => {
    const sections = renderProjectContextSections("/project", emptyContext);
    const output = sections.join("\n");

    expect(output).not.toContain("Lockfiles Detected");
  });

  test("renders all sections in correct order when fully populated", () => {
    const context: ProjectContext = {
      directoryTree: "src/",
      packageFiles: ["package.json"],
      ciConfigs: [".github/workflows/ci.yml"],
      toolConfigs: ["tsconfig.json"],
      shellScripts: ["test.sh"],
      lockfiles: [{ file: "bun.lockb", packageManager: "bun" }],
    };
    const sections = renderProjectContextSections("/project", context);
    const output = sections.join("\n");

    const locationIdx = output.indexOf("## Project Location");
    const structureIdx = output.indexOf("## Project Structure");
    const packageIdx = output.indexOf("## Package/Build Files Found");
    const ciIdx = output.indexOf("## CI Configuration Files Found");
    const toolIdx = output.indexOf("## Tool Configuration Files Found");
    const shellIdx = output.indexOf("## Shell Scripts Found");
    const lockIdx = output.indexOf("## Lockfiles Detected");

    expect(locationIdx).toBeLessThan(structureIdx);
    expect(structureIdx).toBeLessThan(packageIdx);
    expect(packageIdx).toBeLessThan(ciIdx);
    expect(ciIdx).toBeLessThan(toolIdx);
    expect(toolIdx).toBeLessThan(shellIdx);
    expect(shellIdx).toBeLessThan(lockIdx);
  });
});
