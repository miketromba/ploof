import chalk from "chalk";

export class CliError extends Error {
	constructor(
		message: string,
		readonly code = 1,
	) {
		super(message);
		this.name = "CliError";
	}
}

export function formatError(err: unknown, noColor = false): string {
	const message = err instanceof Error ? err.message : String(err);
	if (noColor) return `Error: ${message}`;
	return `${chalk.red("Error:")} ${message}`;
}
