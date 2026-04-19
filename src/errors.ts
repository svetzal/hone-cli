export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

export function warn(message: string): void {
  process.stderr.write(`warning: ${message}\n`);
}
