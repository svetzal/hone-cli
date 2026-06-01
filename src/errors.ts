export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

export class SilentExitError extends CliError {
  constructor() {
    super("");
    this.name = "SilentExitError";
  }
}

export function warn(message: string): void {
  process.stderr.write(`warning: ${message}\n`);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
