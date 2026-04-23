import type { CommandRunner } from "./types.ts";

export async function getLatestCommitHash(projectDir: string, run: CommandRunner): Promise<string> {
  const { stdout, exitCode } = await run("git", ["rev-parse", "HEAD"], { cwd: projectDir });
  if (exitCode !== 0) {
    throw new Error(`Failed to get latest commit hash: ${stdout}`);
  }
  return stdout.trim();
}

export async function gitCommit(projectDir: string, message: string, run: CommandRunner): Promise<string> {
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
