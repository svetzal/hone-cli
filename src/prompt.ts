import { createInterface } from "readline";

export interface PromptChoice {
  key: string;
  label: string;
}

export type PromptFn = (message: string, choices: PromptChoice[]) => Promise<string>;

export async function promptChoice(message: string, choices: PromptChoice[]): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });

  process.stderr.write(`\n${message}\n`);
  for (const choice of choices) {
    process.stderr.write(`  [${choice.key}] ${choice.label}\n`);
  }

  return new Promise<string>((resolve) => {
    rl.question("\nChoice: ", (answer) => {
      rl.close();
      const key = answer.trim().toLowerCase();
      const match = choices.find((c) => c.key === key);
      resolve(match ? match.key : choices[0]!.key);
    });
  });
}
