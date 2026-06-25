import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { Auth } from "./auth";
import type { Config } from "./config";
import { getProvider } from "./providers/registry";
import type { AssetInput, JobResult, OperationKind } from "./types";

const inputRefSchema = z.union([
	z.string(),
	z.object({
		source: z.string().optional(),
		task: z.string().optional(),
		mime: z.string().optional(),
		name: z.string().optional(),
	}),
]);

const taskSchema = z.object({
	id: z.string(),
	kind: z.enum(["image.generate", "image.edit"]),
	provider: z.string().default("openai"),
	profile: z.string().optional(),
	needs: z.array(z.string()).default([]),
	prompt: z.string(),
	params: z.record(z.string(), z.unknown()).default({}),
	output: z.string().optional(),
	sidecar: z.boolean().optional(),
	inputs: z
		.object({
			images: z.array(inputRefSchema).optional(),
			mask: inputRefSchema.optional(),
		})
		.optional(),
});

const manifestSchema = z.object({
	version: z.union([z.literal(1), z.string()]).default(1),
	parallel: z.number().int().positive().optional(),
	tasks: z.array(taskSchema).min(1),
});

export type Manifest = z.infer<typeof manifestSchema>;
type ManifestTask = Manifest["tasks"][number];

export interface RunManifestOptions {
	parallel?: number;
	dryRun?: boolean;
	auth?: Auth;
	config?: Config;
	verbose?: boolean;
}

export async function parseManifest(path: string): Promise<Manifest> {
	const raw = await readFile(path, "utf-8");
	const ext = extname(path).toLowerCase();
	const parsed = ext === ".json" ? JSON.parse(raw) : parseYaml(raw);
	const manifest = manifestSchema.parse(parsed);
	validateManifest(manifest);
	return manifest;
}

export async function runManifest(
	path: string,
	options: RunManifestOptions = {},
): Promise<JobResult[]> {
	const manifest = await parseManifest(path);
	const parallel = options.parallel ?? manifest.parallel ?? 4;
	const baseDir = dirname(resolve(path));

	if (options.dryRun) {
		return manifest.tasks.map((task) => ({
			id: task.id,
			kind: task.kind,
			provider: task.provider,
			profile: task.profile,
			outputs: task.output ? [resolveMaybe(baseDir, task.output)] : [],
			metadata: {
				dryRun: true,
				needs: task.needs,
			},
		}));
	}

	const auth = options.auth ?? new Auth();
	const completed = new Map<string, JobResult>();
	const running = new Map<string, Promise<void>>();
	const pending = new Map(manifest.tasks.map((task) => [task.id, task]));
	const results: JobResult[] = [];
	let failure: unknown;

	while (pending.size > 0 || running.size > 0) {
		if (failure) throw failure;

		for (const [id, task] of [...pending]) {
			if (running.size >= parallel) break;
			if (!task.needs.every((need) => completed.has(need))) continue;

			pending.delete(id);
			const promise = executeTask(task, {
				auth,
				baseDir,
				completed,
				verbose: options.verbose,
				sidecar: options.config?.get("sidecar") ?? true,
			})
				.then((result) => {
					completed.set(id, result);
					results.push(result);
				})
				.catch((err) => {
					failure = err;
				})
				.finally(() => {
					running.delete(id);
				});
			running.set(id, promise);
		}

		if (running.size === 0 && pending.size > 0) {
			throw new Error("Manifest has unresolved dependencies.");
		}

		if (running.size > 0) {
			await Promise.race(running.values());
		}
	}

	if (failure) throw failure;
	return results;
}

function validateManifest(manifest: Manifest): void {
	const ids = new Set<string>();
	for (const task of manifest.tasks) {
		if (ids.has(task.id)) {
			throw new Error(`Duplicate task id: ${task.id}`);
		}
		ids.add(task.id);
	}
	for (const task of manifest.tasks) {
		for (const need of task.needs) {
			if (!ids.has(need)) {
				throw new Error(`Task ${task.id} depends on unknown task ${need}.`);
			}
		}
	}
}

async function executeTask(
	task: ManifestTask,
	options: {
		auth: Auth;
		baseDir: string;
		completed: Map<string, JobResult>;
		verbose?: boolean;
		sidecar: boolean;
	},
): Promise<JobResult> {
	const provider = getProvider(task.provider);
	const credential = options.auth.getCredential(task.provider, task.profile);
	if (!credential?.apiKey) {
		throw new Error(
			`No credentials found for ${task.provider}. Run 'ploof login ${task.provider}'.`,
		);
	}

	const base = {
		id: task.id,
		kind: task.kind as OperationKind,
		provider: task.provider,
		profile: task.profile,
		prompt: task.prompt,
		params: task.params,
		output: task.output
			? resolveMaybe(options.baseDir, task.output)
			: undefined,
		sidecar: task.sidecar ?? options.sidecar,
	};

	if (task.kind === "image.generate") {
		return provider.runImageGenerate(
			{ ...base, kind: "image.generate" },
			{ credential, verbose: options.verbose, sidecar: base.sidecar },
		);
	}

	const inputs = resolveInputs(task, options);
	return provider.runImageEdit(
		{ ...base, kind: "image.edit", inputs },
		{ credential, verbose: options.verbose, sidecar: base.sidecar },
	);
}

function resolveInputs(
	task: ManifestTask,
	options: {
		baseDir: string;
		completed: Map<string, JobResult>;
	},
): AssetInput[] {
	const result: AssetInput[] = [];
	for (const image of task.inputs?.images ?? []) {
		result.push({
			role: "image",
			source: resolveInputRef(image, options),
		});
	}
	if (task.inputs?.mask) {
		result.push({
			role: "mask",
			source: resolveInputRef(task.inputs.mask, options),
		});
	}
	return result;
}

function resolveInputRef(
	ref: z.infer<typeof inputRefSchema>,
	options: {
		baseDir: string;
		completed: Map<string, JobResult>;
	},
): string {
	if (typeof ref === "string") return resolveMaybe(options.baseDir, ref);
	if (ref.task) {
		const result = options.completed.get(ref.task);
		const output = result?.outputs[0];
		if (!output) {
			throw new Error(`Task output not available: ${ref.task}`);
		}
		return output;
	}
	if (ref.source) return resolveMaybe(options.baseDir, ref.source);
	throw new Error("Input reference must include source or task.");
}

function resolveMaybe(baseDir: string, value: string): string {
	if (
		value.startsWith("/") ||
		value.startsWith("http://") ||
		value.startsWith("https://") ||
		value === "-"
	) {
		return value;
	}
	return resolve(baseDir, value);
}
