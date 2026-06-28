import chalk from "chalk";
import type { JobResult, OutputFormat, OutputOptions } from "./types";

export function resolveFormat(
	explicit: string | undefined,
	configured: string | undefined,
	envVar: string | undefined,
	isTTY: boolean,
): OutputFormat {
	const value = explicit ?? envVar ?? configured;
	if (value && value !== "auto") {
		if (isOutputFormat(value)) return value;
		throw new Error(`Invalid output format: ${value}`);
	}
	return isTTY ? "table" : "compact";
}

export function formatResult(
	result: JobResult | JobResult[],
	options: OutputOptions,
): string {
	const results = Array.isArray(result) ? result : [result];
	const selected = options.fields?.length
		? results.map((item) =>
				selectFields(
					item as unknown as Record<string, unknown>,
					options.fields!,
				),
			)
		: results;

	switch (options.format) {
		case "json":
			return JSON.stringify(
				Array.isArray(result) ? selected : selected[0],
				null,
				2,
			);
		case "jsonl":
			return selected.map((item) => JSON.stringify(item)).join("\n");
		case "table":
			return formatTable(results, options);
		case "compact":
			return results.map(formatCompact).join("\n");
	}
}

function formatCompact(result: JobResult): string {
	const parts = [
		result.id ? `id=${result.id}` : undefined,
		`kind=${result.kind}`,
		`provider=${result.provider}`,
		result.profile ? `profile=${result.profile}` : undefined,
		`outputs=${result.outputs.join(",")}`,
	].filter(Boolean);
	return `asset ${parts.join(" ")}`;
}

function formatTable(results: JobResult[], options: OutputOptions): string {
	if (results.length === 0) return "No results.";

	const rows = results.map((result) => ({
		id: result.id ?? "-",
		kind: result.kind,
		provider: result.provider,
		outputs: result.outputs.join(", "),
	}));
	const header = ["ID", "Kind", "Provider", "Outputs"];
	const widths = [
		Math.max(header[0]!.length, ...rows.map((r) => r.id.length)),
		Math.max(header[1]!.length, ...rows.map((r) => r.kind.length)),
		Math.max(header[2]!.length, ...rows.map((r) => r.provider.length)),
		Math.max(header[3]!.length, ...rows.map((r) => r.outputs.length)),
	];

	const color = options.noColor ? (s: string) => s : chalk.bold;
	const lines = [
		header.map((h, i) => color(h.padEnd(widths[i]!))).join("  "),
		widths.map((w) => "-".repeat(w)).join("  "),
	];

	for (const row of rows) {
		lines.push(
			[
				row.id.padEnd(widths[0]!),
				row.kind.padEnd(widths[1]!),
				row.provider.padEnd(widths[2]!),
				row.outputs.padEnd(widths[3]!),
			].join("  "),
		);
	}

	return lines.join("\n");
}

function selectFields(
	item: Record<string, unknown>,
	fields: string[],
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const field of fields) {
		result[field] = getPath(item, field);
	}
	return result;
}

function getPath(item: Record<string, unknown>, path: string): unknown {
	let current: unknown = item;
	for (const part of path.split(".")) {
		if (!current || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

function isOutputFormat(value: string): value is OutputFormat {
	return ["table", "compact", "json", "jsonl"].includes(value);
}
