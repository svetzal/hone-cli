import { ensureAuditDir, saveStageOutput } from "./audit.ts";
import { checkCharter } from "./charter.ts";
import { parseAssessment } from "./parse-assessment.ts";
import { triage as runTriageDefault } from "./triage.ts";
import { runAllGates } from "./gates.ts";
import { resolveGates } from "./resolve-gates.ts";
import {
  runAssessStage,
  runNameStage,
  runPlanStage,
  runExecuteWithVerify,
} from "./iterate.ts";
import {
  getRepoOwner,
  listHoneIssues,
  getIssueReactions,
  createHoneIssue,
  closeIssueWithComment,
  formatIssueBody,
  parseIssueBody,
  getLatestCommitHash,
  gitCommit,
  createCommandRunner,
} from "./github.ts";
import type {
  HoneConfig,
  ClaudeInvoker,
  CommandRunner,
  GateDefinition,
  GatesRunResult,
  GitHubIterateResult,
  ExecutionOutcome,
  CharterCheckResult,
  StructuredAssessment,
  TriageResult,
} from "./types.ts";

export interface GitHubIterateOptions {
  agent: string;
  folder: string;
  config: HoneConfig;
  proposals: number;
  skipGates: boolean;
  skipTriage: boolean;
  skipCharter?: boolean;
  onProgress: (stage: string, message: string) => void;
  ghRunner?: CommandRunner;
  gateRunner?: (gates: GateDefinition[], projectDir: string, timeout: number) => Promise<GatesRunResult>;
  gateResolver?: (projectDir: string, agentName: string, model: string, readOnlyTools: string, claude: ClaudeInvoker) => Promise<GateDefinition[]>;
  charterChecker?: (projectDir: string, minLength: number) => Promise<CharterCheckResult>;
  triageRunner?: (assessment: StructuredAssessment, threshold: number, model: string, tools: string, claude: ClaudeInvoker) => Promise<TriageResult>;
}

export async function githubIterate(
  opts: GitHubIterateOptions,
  claude: ClaudeInvoker,
): Promise<GitHubIterateResult> {
  const {
    agent,
    folder,
    config,
    proposals,
    skipGates,
    skipTriage,
    skipCharter = false,
    onProgress,
    ghRunner = createCommandRunner(),
    gateRunner = runAllGates,
    gateResolver = resolveGates,
    charterChecker = checkCharter,
    triageRunner = runTriageDefault,
  } = opts;

  const result: GitHubIterateResult = {
    mode: "github",
    housekeeping: { closed: [] },
    executed: [],
    proposed: [],
    skippedTriage: 0,
  };

  // --- Charter check ---
  if (!skipCharter) {
    onProgress("charter", "Checking project charter clarity...");
    const charterResult = await charterChecker(folder, config.minCharterLength);
    if (!charterResult.passed) {
      onProgress("charter", "Charter clarity insufficient. Cannot proceed in GitHub mode.");
      for (const g of charterResult.guidance) {
        onProgress("charter", `  → ${g}`);
      }
      throw new Error("Charter clarity insufficient");
    }
    onProgress("charter", "Charter check passed.");
  }

  // --- Housekeeping: close thumbs-down issues ---
  onProgress("housekeeping", "Checking for rejected issues...");
  const owner = await getRepoOwner(folder, ghRunner);
  const issues = await listHoneIssues(folder, ghRunner);

  for (const issue of issues) {
    const reactions = await getIssueReactions(folder, issue.number, ghRunner);
    if (reactions.thumbsDown.includes(owner)) {
      onProgress("housekeeping", `Closing rejected issue #${issue.number}: ${issue.title}`);
      await closeIssueWithComment(
        folder,
        issue.number,
        "Closed: rejected by product owner (thumbs-down reaction).",
        ghRunner,
      );
      result.housekeeping.closed.push(issue.number);
    } else {
      // Store reactions for later use
      issue.reactions = reactions;
    }
  }

  // --- Execute approved backlog (thumbs-up from owner, oldest first) ---
  const approvedIssues = issues
    .filter((issue) => issue.reactions.thumbsUp.includes(owner))
    .filter((issue) => !result.housekeeping.closed.includes(issue.number))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  for (const issue of approvedIssues) {
    onProgress("execute", `Processing approved issue #${issue.number}: ${issue.title}`);

    const proposal = parseIssueBody(issue.body);
    if (!proposal) {
      onProgress("execute", `Could not parse proposal from issue #${issue.number}, skipping.`);
      continue;
    }

    const auditDir = await ensureAuditDir(folder, config.auditDir);
    const name = `github-${issue.number}`;

    const outcome: ExecutionOutcome = {
      issueNumber: issue.number,
      success: false,
      commitHash: null,
      gatesResult: null,
      retries: 0,
    };

    try {
      const execResult = await runExecuteWithVerify(
        proposal.agent,
        folder,
        proposal.assessment,
        proposal.plan,
        config,
        claude,
        {
          skipGates,
          gateRunner,
          gateResolver,
          auditDir,
          name,
          onProgress,
        },
      );

      outcome.gatesResult = execResult.gatesResult;
      outcome.retries = execResult.retries;
      outcome.success = execResult.success;

      if (execResult.success) {
        const commitHash = await gitCommit(
          folder,
          `[Hone] ${issue.title} (#${issue.number})`,
          ghRunner,
        );
        outcome.commitHash = commitHash;

        await closeIssueWithComment(
          folder,
          issue.number,
          `Completed successfully.\n\nCommit: ${commitHash}`,
          ghRunner,
        );
        onProgress("execute", `Issue #${issue.number} completed: ${commitHash}`);
      } else {
        const gateOutput = execResult.gatesResult?.results
          .filter((r) => !r.passed && r.required)
          .map((r) => `**${r.name}:** ${r.output.slice(0, 500)}`)
          .join("\n\n") ?? "Unknown failure";

        await closeIssueWithComment(
          folder,
          issue.number,
          `Failed: quality gates did not pass after ${execResult.retries} retries.\n\n${gateOutput}`,
          ghRunner,
        );
        onProgress("execute", `Issue #${issue.number} failed gate verification.`);
      }
    } catch (err) {
      outcome.error = err instanceof Error ? err.message : String(err);
      onProgress("execute", `Issue #${issue.number} failed: ${outcome.error}`);
    }

    result.executed.push(outcome);
  }

  // --- Propose new improvements ---
  onProgress("propose", `Generating up to ${proposals} proposal(s)...`);
  const auditDir = await ensureAuditDir(folder, config.auditDir);

  for (let i = 0; i < proposals; i++) {
    onProgress("propose", `Proposal ${i + 1}/${proposals}: assessing...`);

    const assessment = await runAssessStage(agent, folder, config, claude);
    const structured = parseAssessment(assessment);
    const name = await runNameStage(agent, assessment, config, claude);

    await saveStageOutput(auditDir, name, "", assessment);

    // Triage
    if (!skipTriage) {
      onProgress("propose", `Proposal ${i + 1}/${proposals}: triaging...`);
      const triageResult = await triageRunner(
        structured,
        config.severityThreshold,
        config.models.triage,
        config.readOnlyTools,
        claude,
      );

      if (!triageResult.accepted) {
        onProgress("propose", `Proposal ${i + 1}/${proposals}: triage rejected — ${triageResult.reason}`);
        result.skippedTriage++;
        continue;
      }
    }

    // Plan
    onProgress("propose", `Proposal ${i + 1}/${proposals}: planning...`);
    const plan = await runPlanStage(agent, assessment, config, claude);
    await saveStageOutput(auditDir, name, "plan", plan);

    // Create issue
    const issueBody = formatIssueBody({
      assessment,
      plan,
      agent,
      severity: structured.severity,
      principle: structured.principle,
    });

    const issueTitle = `[Hone] ${structured.principle}: ${name}`;
    const issueNumber = await createHoneIssue(folder, issueTitle, issueBody, ghRunner);

    onProgress("propose", `Created issue #${issueNumber}: ${issueTitle}`);
    result.proposed.push(issueNumber);
  }

  return result;
}
