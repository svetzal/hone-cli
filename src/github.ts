import { warn } from "./errors.ts";
import type { CommandRunner, HoneIssue } from "./types.ts";

export async function getRepoOwner(projectDir: string, run: CommandRunner): Promise<string> {
  const { stdout, exitCode } = await run("gh", ["repo", "view", "--json", "owner", "--jq", ".owner.login"], {
    cwd: projectDir,
  });
  if (exitCode !== 0) {
    throw new Error(`Failed to get repo owner: ${stdout}`);
  }
  return stdout.trim();
}

export async function getRepoNameWithOwner(projectDir: string, run: CommandRunner): Promise<string> {
  const { stdout, exitCode } = await run("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], {
    cwd: projectDir,
  });
  if (exitCode !== 0) {
    throw new Error(`Failed to get repo name: ${stdout}`);
  }
  return stdout.trim();
}

function validateIssueArray(raw: unknown): Array<{ number: number; title: string; body: string; createdAt: string }> {
  if (!Array.isArray(raw)) return [];

  return raw.filter(
    (item): item is { number: number; title: string; body: string; createdAt: string } =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>).number === "number" &&
      typeof (item as Record<string, unknown>).title === "string" &&
      typeof (item as Record<string, unknown>).body === "string" &&
      typeof (item as Record<string, unknown>).createdAt === "string",
  );
}

export async function listHoneIssues(projectDir: string, run: CommandRunner): Promise<HoneIssue[]> {
  const { stdout, exitCode } = await run(
    "gh",
    ["issue", "list", "--label", "hone", "--state", "open", "--json", "number,title,body,createdAt", "--limit", "100"],
    { cwd: projectDir },
  );
  if (exitCode !== 0) {
    throw new Error(`Failed to list issues: ${stdout}`);
  }

  const raw: unknown = JSON.parse(stdout || "[]");
  const issues = validateIssueArray(raw);

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
    [
      "api",
      `repos/${repoName}/issues/${issueNumber}/reactions`,
      "--jq",
      ".[] | {user: .user.login, content: .content}",
    ],
    { cwd: projectDir },
  );
  if (exitCode !== 0) {
    warn(`Failed to fetch reactions for issue #${issueNumber}: ${stdout}`);
    return { thumbsUp: [], thumbsDown: [] };
  }

  const thumbsUp: string[] = [];
  const thumbsDown: string[] = [];

  // Parse JSONL output (one JSON object per line)
  for (const line of stdout.trim().split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as Record<string, unknown>).user === "string" &&
        typeof (parsed as Record<string, unknown>).content === "string"
      ) {
        const reaction = parsed as { user: string; content: string };
        if (reaction.content === "+1") thumbsUp.push(reaction.user);
        if (reaction.content === "-1") thumbsDown.push(reaction.user);
      }
    } catch {
      warn(`Skipping malformed reactions line: ${line}`);
    }
  }

  return { thumbsUp, thumbsDown };
}

export async function ensureHoneLabel(projectDir: string, run: CommandRunner): Promise<void> {
  // Try to create the label; ignore errors if it already exists
  await run("gh", ["label", "create", "hone", "--description", "Hone improvement proposal", "--color", "0e8a16"], {
    cwd: projectDir,
  });
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
  const { exitCode, stdout } = await run("gh", ["issue", "close", String(issueNumber), "--comment", comment], {
    cwd: projectDir,
  });
  if (exitCode !== 0) {
    throw new Error(`Failed to close issue #${issueNumber}: ${stdout}`);
  }
}
