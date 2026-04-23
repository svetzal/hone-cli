import { describe, expect, test } from "bun:test";
import { formatIssueBody, parseIssueBody } from "./issue-body.ts";

describe("formatIssueBody / parseIssueBody", () => {
  test("round-trip: format then parse", () => {
    const proposal = {
      name: "fix-srp-violation",
      assessment: "The code violates SRP.",
      plan: "Step 1: Extract class\nStep 2: Move methods",
      agent: "typescript-craftsperson",
      severity: 4,
      principle: "Single Responsibility",
    };

    const body = formatIssueBody(proposal);
    const parsed = parseIssueBody(body);

    expect(parsed).not.toBeNull();
    expect(parsed?.name).toBe("fix-srp-violation");
    expect(parsed?.agent).toBe("typescript-craftsperson");
    expect(parsed?.severity).toBe(4);
    expect(parsed?.principle).toBe("Single Responsibility");
    expect(parsed?.assessment).toBe("The code violates SRP.");
    expect(parsed?.plan).toBe("Step 1: Extract class\nStep 2: Move methods");
  });

  test("parseIssueBody returns null for non-hone body", () => {
    const result = parseIssueBody("This is a regular issue body without metadata.");
    expect(result).toBeNull();
  });

  test("parseIssueBody returns null for malformed metadata", () => {
    const result = parseIssueBody("<!-- hone-metadata\ninvalid json\n-->");
    expect(result).toBeNull();
  });

  test("parseIssueBody returns null when agent is a number instead of string", () => {
    const body = `<!-- hone-metadata\n${JSON.stringify({ agent: 42, severity: 3, principle: "SRP" })}\n-->`;
    expect(parseIssueBody(body)).toBeNull();
  });

  test("parseIssueBody returns null when severity is missing", () => {
    const body = `<!-- hone-metadata\n${JSON.stringify({ agent: "typescript-craftsperson", principle: "SRP" })}\n-->`;
    expect(parseIssueBody(body)).toBeNull();
  });

  test("parseIssueBody returns null when severity is a string instead of number", () => {
    const body = `<!-- hone-metadata\n${JSON.stringify({ agent: "typescript-craftsperson", severity: "high", principle: "SRP" })}\n-->`;
    expect(parseIssueBody(body)).toBeNull();
  });
});
