import type { CommandRunner, HoneIssue, HoneProposal } from "./types.ts";
import { runProcess } from "./process.ts";

export async function getRepoOwner(
  projectDir: string,
  run: CommandRunner,
): Promise<string> {
  const { stdout, exitCode } = await run(
    "gh",
    ["repo", "view", "--json", "owner", "--jq", ".owner.login"],
    { cwd: projectDir },
  );
  if (exitCode !== 0) {
    throw new Error(`Failed to get repo owner: ${stdout}`);
  }
  return stdout.trim();
}

export async function getRepoNameWithOwner(
  projectDir: string,
  run: CommandRunner,
): Promise<string> {
  const { stdout, exitCode } = await run(
    "gh",
    ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
    { cwd: projectDir },
  );
  if (exitCode !== 0) {
    throw new Error(`Failed to get repo name: ${stdout}`);
  }
  return stdout.trim();
}

export async function listHoneIssues(
  projectDir: string,
  run: CommandRunner,
): Promise<HoneIssue[]> {
  const { stdout, exitCode } = await run(
    "gh",
    ["issue", "list", "--label", "hone", "--state", "open", "--json", "number,title,body,createdAt", "--limit", "100"],
    { cwd: projectDir },
  );
  if (exitCode !== 0) {
    throw new Error(`Failed to list issues: ${stdout}`);
  }

  const issues: Array<{ number: number; title: string; body: string; createdAt: string }> = JSON.parse(stdout || "[]");

  return issues.map((issue) => ({
    number: issue.number,
    title: issue.title,
    body: issue.body,
    reactions: { thumbsUp: [], thumbsDown: [] },
    createdAt: issue.createdAt,
  }));
}

export async function getIssueReactions(
  projectDir: string,
  issueNumber: number,
  run: CommandRunner,
): Promise<{ thumbsUp: string[]; thumbsDown: string[] }> {
  const repoName = await getRepoNameWithOwner(projectDir, run);
  const { stdout, exitCode } = await run(
    "gh",
    ["api", `repos/${repoName}/issues/${issueNumber}/reactions`, "--jq", ".[] | {user: .user.login, content: .content}"],
    { cwd: projectDir },
  );
  if (exitCode !== 0) {
    // No reactions or API error — return empty
    return { thumbsUp: [], thumbsDown: [] };
  }

  const thumbsUp: string[] = [];
  const thumbsDown: string[] = [];

  // Parse JSONL output (one JSON object per line)
  for (const line of stdout.trim().split("\n")) {
    if (!line.trim()) continue;
    try {
      const reaction = JSON.parse(line) as { user: string; content: string };
      if (reaction.content === "+1") thumbsUp.push(reaction.user);
      if (reaction.content === "-1") thumbsDown.push(reaction.user);
    } catch {
      // Skip malformed lines
    }
  }

  return { thumbsUp, thumbsDown };
}

export async function ensureHoneLabel(
  projectDir: string,
  run: CommandRunner,
): Promise<void> {
  // Try to create the label; ignore errors if it already exists
  await run(
    "gh",
    ["label", "create", "hone", "--description", "Hone improvement proposal", "--color", "0e8a16"],
    { cwd: projectDir },
  );
}

export async function createHoneIssue(
  projectDir: string,
  title: string,
  body: string,
  run: CommandRunner,
): Promise<number> {
  const { stdout, exitCode } = await run(
    "gh",
    ["issue", "create", "--title", title, "--body", body, "--label", "hone"],
    { cwd: projectDir },
  );
  if (exitCode !== 0) {
    throw new Error(`Failed to create issue: ${stdout}`);
  }

  // gh issue create prints the URL, extract issue number from it
  const match = stdout.trim().match(/\/issues\/(\d+)/);
  if (!match?.[1]) {
    throw new Error(`Could not parse issue number from: ${stdout}`);
  }
  return parseInt(match[1], 10);
}

export async function closeIssueWithComment(
  projectDir: string,
  issueNumber: number,
  comment: string,
  run: CommandRunner,
): Promise<void> {
  const { exitCode, stdout } = await run(
    "gh",
    ["issue", "close", String(issueNumber), "--comment", comment],
    { cwd: projectDir },
  );
  if (exitCode !== 0) {
    throw new Error(`Failed to close issue #${issueNumber}: ${stdout}`);
  }
}

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
    const metadata = JSON.parse(body.slice(metaStart, metaEnd).trim()) as {
      agent: string;
      severity: number;
      principle: string;
      name?: string;
    };

    // Extract assessment and plan from markdown sections
    const assessmentMatch = body.match(/## Assessment\s*\n([\s\S]*?)(?=\n## Plan)/);
    const planMatch = body.match(/## Plan\s*\n([\s\S]*?)$/);

    return {
      name: metadata.name ?? "",
      assessment: assessmentMatch?.[1]?.trim() ?? "",
      plan: planMatch?.[1]?.trim() ?? "",
      agent: metadata.agent,
      severity: metadata.severity,
      principle: metadata.principle,
    };
  } catch {
    return null;
  }
}

export async function getLatestCommitHash(
  projectDir: string,
  run: CommandRunner,
): Promise<string> {
  const { stdout, exitCode } = await run("git", ["rev-parse", "HEAD"], { cwd: projectDir });
  if (exitCode !== 0) {
    throw new Error(`Failed to get latest commit hash: ${stdout}`);
  }
  return stdout.trim();
}

export async function gitCommit(
  projectDir: string,
  message: string,
  run: CommandRunner,
): Promise<string> {
  // Stage all changes
  const addResult = await run("git", ["add", "-A"], { cwd: projectDir });
  if (addResult.exitCode !== 0) {
    throw new Error(`git add failed: ${addResult.stdout}`);
  }

  // Commit
  const commitResult = await run("git", ["commit", "-m", message], { cwd: projectDir });
  if (commitResult.exitCode !== 0) {
    throw new Error(`git commit failed: ${commitResult.stdout}`);
  }

  // Return the new commit hash
  return getLatestCommitHash(projectDir, run);
}

export function createCommandRunner(): CommandRunner {
  return async (command, args, opts) => {
    const { stdout, stderr, exitCode } = await runProcess(
      [command, ...args],
      { cwd: opts?.cwd },
    );

    return { stdout: (stdout + stderr).trim(), exitCode };
  };
}
