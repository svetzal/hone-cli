import { ensureAuditDir, saveStageOutput } from "./audit.ts";
import { checkCharter } from "./charter.ts";
import { parseAssessment } from "./parse-assessment.ts";
import { triage as runTriageDefault } from "./triage.ts";
import { runAllGates } from "./gates.ts";
import { resolveGates } from "./resolve-gates.ts";
import { runPreamble } from "./preamble.ts";
import {
  runAssessStage,
  runNameStage,
  runPlanStage,
  buildRetryPrompt,
} from "./iterate.ts";
import { runExecuteWithVerify } from "./execute-with-verify.ts";
import {
  getRepoOwner,
  ensureHoneLabel,
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
  CommandRunner,
  GateDefinition,
  GitHubIterateResult,
  ExecutionOutcome,
  GateRunner,
  GateResolverFn,
  CharterCheckerFn,
  TriageRunnerFn,
  HoneIssue,
  PipelineContext,
} from "./types.ts";

export interface GitHubIterateOptions {
  ctx: PipelineContext;
  proposals: number;
  skipGates: boolean;
  skipTriage: boolean;
  skipCharter?: boolean;
  ghRunner?: CommandRunner;
  gateRunner?: GateRunner;
  gateResolver?: GateResolverFn;
  charterChecker?: CharterCheckerFn;
  triageRunner?: TriageRunnerFn;
}

/**
 * Phase 1: Close issues that the repo owner has thumbs-downed.
 * Returns array of closed issue numbers.
 */
export async function closeRejectedIssues(
  issues: HoneIssue[],
  owner: string,
  folder: string,
  run: CommandRunner,
  onProgress: (stage: string, message: string) => void,
): Promise<number[]> {
  const closed: number[] = [];

  for (const issue of issues) {
    const reactions = await getIssueReactions(folder, issue.number, run);
    if (reactions.thumbsDown.includes(owner)) {
      onProgress("housekeeping", `Closing rejected issue #${issue.number}: ${issue.title}`);
      await closeIssueWithComment(
        folder,
        issue.number,
        "Closed: rejected by product owner (thumbs-down reaction).",
        run,
      );
      closed.push(issue.number);
    } else {
      // Store reactions for later use by executeApprovedIssues
      issue.reactions = reactions;
    }
  }

  return closed;
}

/**
 * Phase 2: Execute issues that the repo owner has thumbs-upped.
 * Processes oldest first, commits on success, closes with result.
 */
export async function executeApprovedIssues(
  issues: HoneIssue[],
  owner: string,
  closedIssueNumbers: number[],
  ctx: PipelineContext,
  opts: {
    skipGates: boolean;
    gateRunner: GateRunner;
    gates: GateDefinition[];
    ghRunner: CommandRunner;
  },
): Promise<ExecutionOutcome[]> {
  const { skipGates, gateRunner, gates, ghRunner } = opts;
  const { folder, onProgress } = ctx;
  const executed: ExecutionOutcome[] = [];

  const approvedIssues = issues
    .filter((issue) => issue.reactions.thumbsUp.includes(owner))
    .filter((issue) => !closedIssueNumbers.includes(issue.number))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  for (const issue of approvedIssues) {
    onProgress("execute", `Processing approved issue #${issue.number}: ${issue.title}`);

    const proposal = parseIssueBody(issue.body);
    if (!proposal) {
      onProgress("execute", `Could not parse proposal from issue #${issue.number}, skipping.`);
      continue;
    }

    const auditDir = await ensureAuditDir(folder, ctx.config.auditDir);
    const name = proposal.name || `github-${issue.number}`;

    const outcome: ExecutionOutcome = {
      issueNumber: issue.number,
      success: false,
      commitHash: null,
      gatesResult: null,
      retries: 0,
    };

    try {
      const executePrompt = [
        `Execute the following plan to improve the project in ${folder}.`,
        "",
        "Why:",
        proposal.assessment,
        "",
        "Plan:",
        proposal.plan,
      ].join("\n");

      // Each issue may have been proposed by a different agent
      const proposalCtx: PipelineContext = { ...ctx, agent: proposal.agent };
      const execResult = await runExecuteWithVerify(proposalCtx, executePrompt, {
        skipGates,
        gateRunner,
        gates,
        auditDir,
        name,
        buildRetryPrompt: (failedGates, priorAttempts) =>
          buildRetryPrompt(folder, proposal.plan, proposal.assessment, failedGates, priorAttempts),
      });

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

    executed.push(outcome);
  }

  return executed;
}

/**
 * Phase 3: Propose new improvements.
 * Runs assessment, triage, planning, and creates GitHub issues.
 */
export async function proposeImprovements(
  ctx: PipelineContext,
  opts: {
    proposals: number;
    skipTriage: boolean;
    ghRunner: CommandRunner;
    triageRunner: TriageRunnerFn;
  },
): Promise<{ proposed: number[]; skippedTriage: number }> {
  const { proposals, skipTriage, ghRunner, triageRunner } = opts;
  const { folder, config, claude, onProgress } = ctx;
  const proposed: number[] = [];
  let skippedTriage = 0;

  onProgress("propose", `Generating up to ${proposals} proposal(s)...`);
  const auditDir = await ensureAuditDir(folder, config.auditDir);

  for (let i = 0; i < proposals; i++) {
    onProgress("propose", `Proposal ${i + 1}/${proposals}: assessing...`);

    const assessment = await runAssessStage(ctx);
    const structured = parseAssessment(assessment);
    const name = await runNameStage(ctx, assessment);

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
        skippedTriage++;
        continue;
      }
    }

    // Plan
    onProgress("propose", `Proposal ${i + 1}/${proposals}: planning...`);
    const plan = await runPlanStage(ctx, assessment);
    await saveStageOutput(auditDir, name, "plan", plan);

    // Create issue
    const issueBody = formatIssueBody({
      name,
      assessment,
      plan,
      agent: ctx.agent,
      severity: structured.severity,
      principle: structured.principle,
    });

    const issueTitle = `[Hone] ${structured.principle}: ${name}`;
    const issueNumber = await createHoneIssue(folder, issueTitle, issueBody, ghRunner);

    onProgress("propose", `Created issue #${issueNumber}: ${issueTitle}`);
    proposed.push(issueNumber);
  }

  return { proposed, skippedTriage };
}

export async function githubIterate(opts: GitHubIterateOptions): Promise<GitHubIterateResult> {
  const {
    ctx,
    proposals,
    skipGates,
    skipTriage,
    skipCharter = false,
    ghRunner = createCommandRunner(),
    gateRunner = runAllGates,
    gateResolver = resolveGates,
    charterChecker = checkCharter,
    triageRunner = runTriageDefault,
  } = opts;

  const { folder, onProgress } = ctx;

  // --- Run preamble (charter check + preflight gate validation) ---
  const preambleResult = await runPreamble({
    ctx,
    skipCharter,
    skipGates,
    gateResolver,
    gateRunner,
    charterChecker,
  });

  if (!preambleResult.passed) {
    throw new Error(preambleResult.failureReason);
  }

  const preflightGates = preambleResult.gates;

  // --- Ensure hone label exists ---
  await ensureHoneLabel(folder, ghRunner);

  // --- Fetch owner and issues ---
  onProgress("housekeeping", "Checking for rejected issues...");
  const owner = await getRepoOwner(folder, ghRunner);
  const issues = await listHoneIssues(folder, ghRunner);

  // --- Phase 1: Close rejected issues ---
  const closed = await closeRejectedIssues(issues, owner, folder, ghRunner, onProgress);

  // --- Phase 2: Execute approved backlog ---
  const executed = await executeApprovedIssues(
    issues,
    owner,
    closed,
    ctx,
    { skipGates, gateRunner, gates: preflightGates, ghRunner },
  );

  // --- Phase 3: Propose new improvements ---
  const { proposed, skippedTriage } = await proposeImprovements(
    ctx,
    { proposals, skipTriage, ghRunner, triageRunner },
  );

  return {
    mode: "github",
    housekeeping: { closed },
    executed,
    proposed,
    skippedTriage,
  };
}
