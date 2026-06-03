/**
 * Single source of truth for the stable opening substrings used to dispatch
 * mock Claude calls in tests. Each key corresponds to a dispatchable pipeline
 * stage; the value is the exact opening text produced by the matching prompt
 * builder.
 *
 * Rules:
 * - Anchors must match the ACTUAL opening of the prompt string (startsWith).
 * - Do not change an anchor without updating the corresponding prompt builder.
 * - Test mocks use these constants instead of inline string literals.
 */
export const PROMPT_ANCHORS = Object.freeze({
  assess: "Assess the project in",
  name: "Output ONLY a short kebab-case filename",
  plan: "Based on the following assessment",
  execute: "You are running inside a hone iterate run",
  retry: "## Goal",
  summarize: "Generate a headline and summary",
  triage: "You are a skeptical code review triage system",
  derive: "You are creating a custom craftsperson agent",
  deriveGates: "You are discovering quality gates",
  mixPrinciples: "You are augmenting a local agent's engineering principles",
  mixGates: "You are augmenting a local agent's quality assurance",
  maintain: "You are running inside a hone maintenance run",
} as const);
