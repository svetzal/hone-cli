import { describe, expect, it } from "bun:test";
import { extractAgentName } from "./agent-frontmatter.ts";

describe("extractAgentName", () => {
  describe("frontmatter path", () => {
    it("should extract name from YAML frontmatter", () => {
      const content = "---\nname: foo-bar\n---\n\n# Some heading";
      expect(extractAgentName(content)).toBe("foo-bar");
    });

    it("should strip double quotes from frontmatter name", () => {
      const content = '---\nname: "quoted-name"\n---\n\n# Heading';
      expect(extractAgentName(content)).toBe("quoted-name");
    });

    it("should strip single quotes from frontmatter name", () => {
      const content = "---\nname: 'single-quoted'\n---\n\n# Heading";
      expect(extractAgentName(content)).toBe("single-quoted");
    });

    it("should fall through to heading when frontmatter has no name field", () => {
      const content = "---\ndescription: something\n---\n\n# My Agent";
      expect(extractAgentName(content)).toBe("my-agent");
    });
  });

  describe("heading fallback", () => {
    it("should slugify a heading when no frontmatter is present", () => {
      const content = "# My Agent Name";
      expect(extractAgentName(content)).toBe("my-agent-name");
    });

    it("should lowercase the heading", () => {
      const content = "# TypeScript Craftsperson";
      expect(extractAgentName(content)).toBe("typescript-craftsperson");
    });

    it("should collapse non-alphanumeric characters to dashes and trim leading/trailing dashes", () => {
      const content = "# !!Foo Bar!!";
      expect(extractAgentName(content)).toBe("foo-bar");
    });
  });

  describe("default branch", () => {
    it("should return derived-agent when there is neither frontmatter nor a heading", () => {
      const content = "Just some plain text with no heading.";
      expect(extractAgentName(content)).toBe("derived-agent");
    });

    it("should return derived-agent for empty string", () => {
      expect(extractAgentName("")).toBe("derived-agent");
    });
  });
});
