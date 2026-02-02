/**
 * Output utilities for handling --json flag consistently across commands
 */

/**
 * Write structured data as JSON to stdout
 * Used when --json flag is active
 */
export function writeJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Write progress/status messages to appropriate stream
 * - Normal mode: stdout (human-readable)
 * - JSON mode: stderr (keeps stdout clean for JSON data)
 */
export function progress(json: boolean, message: string): void {
  if (!json) {
    console.log(message);
  } else {
    console.error(message);
  }
}
