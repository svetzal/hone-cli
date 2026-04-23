import type { HoneProposal } from "./types.ts";

const ISSUE_BODY_MARKER = "<!-- hone-metadata";
const ISSUE_BODY_END_MARKER = "-->";

export function formatIssueBody(proposal: {
  name: string;
  assessment: string;
  plan: string;
  agent: string;
  severity: number;
  principle: string;
}): string {
  const metadata = JSON.stringify({
    agent: proposal.agent,
    severity: proposal.severity,
    principle: proposal.principle,
    name: proposal.name,
  });

  return [
    `${ISSUE_BODY_MARKER}`,
    metadata,
    ISSUE_BODY_END_MARKER,
    "",
    `**Agent:** ${proposal.agent}`,
    `**Severity:** ${proposal.severity}/5`,
    `**Principle:** ${proposal.principle}`,
    "",
    "## Assessment",
    "",
    proposal.assessment,
    "",
    "## Plan",
    "",
    proposal.plan,
  ].join("\n");
}

export function parseIssueBody(body: string): HoneProposal | null {
  const startIdx = body.indexOf(ISSUE_BODY_MARKER);
  if (startIdx === -1) return null;

  const metaStart = startIdx + ISSUE_BODY_MARKER.length;
  const metaEnd = body.indexOf(ISSUE_BODY_END_MARKER, metaStart);
  if (metaEnd === -1) return null;

  try {
    const raw: unknown = JSON.parse(body.slice(metaStart, metaEnd).trim());
    if (typeof raw !== "object" || raw === null) return null;

    const obj = raw as Record<string, unknown>;
    if (typeof obj.agent !== "string") return null;
    if (typeof obj.severity !== "number") return null;
    if (typeof obj.principle !== "string") return null;

    const name = typeof obj.name === "string" ? obj.name : "";

    // Extract assessment and plan from markdown sections
    const assessmentMatch = body.match(/## Assessment\s*\n([\s\S]*?)(?=\n## Plan)/);
    const planMatch = body.match(/## Plan\s*\n([\s\S]*?)$/);

    return {
      name,
      assessment: assessmentMatch?.[1]?.trim() ?? "",
      plan: planMatch?.[1]?.trim() ?? "",
      agent: obj.agent,
      severity: obj.severity,
      principle: obj.principle,
    };
  } catch {
    return null;
  }
}
