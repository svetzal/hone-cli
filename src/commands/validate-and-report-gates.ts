import { runAllGates } from "../gates.ts";
import { progress, reportGateValidation } from "../output.ts";
import type { GateDefinition, GateResult } from "../types.ts";

export async function validateAndReportGates(
  gates: GateDefinition[],
  folder: string,
  timeout: number,
  isJson: boolean,
  message = "Validating gates...",
): Promise<GateResult[]> {
  progress(isJson, message);
  const result = await runAllGates(gates, folder, timeout);
  reportGateValidation(result.results, result.allPassed, isJson);
  return result.results;
}
