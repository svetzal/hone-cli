import type {
  CharterCheckerFn,
  CharterCheckResult,
  GateDefinition,
  GateResolverFn,
  GateRunner,
  GatesRunResult,
  PipelineContext,
} from "./types.ts";

export interface PreambleOptions {
  ctx: PipelineContext;
  skipCharter: boolean;
  skipGates: boolean;
  gateResolver: GateResolverFn;
  gateRunner: GateRunner;
  charterChecker: CharterCheckerFn;
}

export type PreambleResult =
  | {
      passed: true;
      charterCheck: CharterCheckResult | null;
      gates: GateDefinition[];
    }
  | {
      passed: false;
      charterCheck: CharterCheckResult | null;
      gates: GateDefinition[];
      failureStage: "charter" | "preflight";
      failureReason: string;
      gatesResult?: GatesRunResult;
    };

/**
 * Runs the charter check and preflight gate validation that precedes
 * all assessment work in both local and GitHub modes.
 *
 * This function encapsulates the shared "verify project readiness before
 * doing LLM work" logic that was previously duplicated across iterate()
 * and githubIterate().
 */
export async function runPreamble(opts: PreambleOptions): Promise<PreambleResult> {
  const { ctx, skipCharter, skipGates, gateResolver, gateRunner, charterChecker } = opts;
  const { folder, agent, config, claude, onProgress } = ctx;

  // --- Charter check ---
  let charterCheckResult: CharterCheckResult | null = null;
  if (!skipCharter) {
    onProgress("charter", "Checking project charter clarity...");
    charterCheckResult = await charterChecker(folder, config.minCharterLength);
    if (!charterCheckResult.passed) {
      onProgress("charter", "Charter clarity insufficient.");
      for (const g of charterCheckResult.guidance) {
        onProgress("charter", `  → ${g}`);
      }
      return {
        passed: false,
        charterCheck: charterCheckResult,
        gates: [],
        failureStage: "charter",
        failureReason: "Charter clarity insufficient",
      };
    }
    onProgress("charter", "Charter check passed.");
    for (const w of charterCheckResult.warnings) {
      onProgress("charter", `  ⚠ ${w}`);
    }
  }

  // --- Preflight gate validation ---
  let preflightGates: GateDefinition[] = [];
  if (!skipGates) {
    onProgress("preflight", "Resolving quality gates...");
    preflightGates = await gateResolver(folder, agent, {
      model: config.models.gates,
      readOnlyTools: config.readOnlyTools,
      claude,
    });

    if (preflightGates.length > 0) {
      onProgress("preflight", "Running preflight gate check on unmodified codebase...");
      const preflightResult = await gateRunner(preflightGates, folder, config.gateTimeout);

      if (!preflightResult.requiredPassed) {
        onProgress("preflight", "Preflight failed: required gates do not pass on unmodified codebase.");
        return {
          passed: false,
          charterCheck: charterCheckResult,
          gates: preflightGates,
          failureStage: "preflight",
          failureReason: "Preflight failed: required gates do not pass on unmodified codebase",
          gatesResult: preflightResult,
        };
      }
      onProgress("preflight", "Preflight passed.");
    }
  }

  return {
    passed: true,
    charterCheck: charterCheckResult,
    gates: preflightGates,
  };
}
