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
	kind: z.enum([
		"image.generate",
		"image.edit",
		"image.variation",
		"video.generate",
		"video.edit",
		"video.extend",
		"video.remix",
		"video.status",
		"video.download",
		"video.list",
		"video.delete",
		"video.character.create",
		"video.character.get",
	]),
	provider: z.string().default("openai"),
	profile: z.string().optional(),
	needs: z.array(z.string()).default([]),
	prompt: z.string().optional(),
	params: z.record(z.string(), z.unknown()).default({}),
	output: z.string().optional(),
	sidecar: z.boolean().optional(),
	videoId: z.string().optional(),
	characterId: z.string().optional(),
	name: z.string().optional(),
	wait: z.boolean().optional(),
	download: z.boolean().optional(),
	variants: z.array(z.enum(["video", "thumbnail", "spritesheet"])).optional(),
	pollIntervalMs: z.number().int().nonnegative().optional(),
	timeoutMs: z.number().int().nonnegative().optional(),
	inputs: z
		.object({
			images: z.array(inputRefSchema).optional(),
			mask: inputRefSchema.optional(),
			video: inputRefSchema.optional(),
			videos: z.array(inputRefSchema).optional(),
			inputReference: inputRefSchema.optional(),
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
		if (requiresPrompt(task.kind) && !task.prompt) {
			throw new Error(`Task ${task.id} requires a prompt.`);
		}
		if (task.kind === "image.variation" && !task.inputs?.images?.length) {
			throw new Error(`Task ${task.id} requires inputs.images.`);
		}
		if (
			["video.edit", "video.extend"].includes(task.kind) &&
			!task.videoId &&
			!task.inputs?.video &&
			!task.inputs?.videos?.length
		) {
			throw new Error(`Task ${task.id} requires videoId or inputs.video.`);
		}
		if (
			[
				"video.status",
				"video.download",
				"video.delete",
				"video.remix",
			].includes(task.kind) &&
			!task.videoId
		) {
			throw new Error(`Task ${task.id} requires videoId.`);
		}
		if (task.kind === "video.character.create") {
			if (!task.name) throw new Error(`Task ${task.id} requires name.`);
			if (!task.inputs?.video && !task.inputs?.videos?.length) {
				throw new Error(`Task ${task.id} requires inputs.video.`);
			}
		}
		if (task.kind === "video.character.get" && !task.characterId) {
			throw new Error(`Task ${task.id} requires characterId.`);
		}
		for (const need of task.needs) {
			if (!ids.has(need)) {
				throw new Error(`Task ${task.id} depends on unknown task ${need}.`);
			}
		}
	}
}

function requiresPrompt(kind: OperationKind): boolean {
	return [
		"image.generate",
		"image.edit",
		"video.generate",
		"video.edit",
		"video.extend",
		"video.remix",
	].includes(kind);
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
		prompt: task.prompt ?? "",
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
	if (task.kind === "image.variation") {
		return provider.runImageVariation(
			{ ...base, kind: "image.variation", inputs },
			{ credential, verbose: options.verbose, sidecar: base.sidecar },
		);
	}

	if (task.kind === "image.edit") {
		return provider.runImageEdit(
			{ ...base, kind: "image.edit", inputs },
			{ credential, verbose: options.verbose, sidecar: base.sidecar },
		);
	}

	const lifecycle = {
		wait: task.wait,
		download: task.download,
		variants: task.variants,
		pollIntervalMs: task.pollIntervalMs,
		timeoutMs: task.timeoutMs,
	};
	const context = {
		credential,
		verbose: options.verbose,
		sidecar: base.sidecar,
	};
	switch (task.kind) {
		case "video.generate":
			return provider.runVideoGenerate(
				{ ...base, kind: "video.generate", inputs, ...lifecycle },
				context,
			);
		case "video.edit":
			return provider.runVideoEdit(
				{
					...base,
					kind: "video.edit",
					inputs,
					videoId: task.videoId,
					...lifecycle,
				},
				context,
			);
		case "video.extend":
			return provider.runVideoExtend(
				{
					...base,
					kind: "video.extend",
					inputs,
					videoId: task.videoId,
					...lifecycle,
				},
				context,
			);
		case "video.remix":
			return provider.runVideoRemix(
				{
					...base,
					kind: "video.remix",
					videoId: task.videoId ?? "",
					...lifecycle,
				},
				context,
			);
		case "video.status":
			return provider.runVideoStatus(
				{ ...base, kind: "video.status", videoId: task.videoId ?? "" },
				context,
			);
		case "video.download":
			return provider.runVideoDownload(
				{
					...base,
					kind: "video.download",
					videoId: task.videoId ?? "",
					variants: task.variants ?? ["video"],
				},
				context,
			);
		case "video.list":
			return provider.runVideoList({ ...base, kind: "video.list" }, context);
		case "video.delete":
			return provider.runVideoDelete(
				{ ...base, kind: "video.delete", videoId: task.videoId ?? "" },
				context,
			);
		case "video.character.create":
			return provider.runVideoCharacterCreate(
				{
					...base,
					kind: "video.character.create",
					name: task.name ?? "",
					inputs,
				},
				context,
			);
		case "video.character.get":
			return provider.runVideoCharacterGet(
				{
					...base,
					kind: "video.character.get",
					characterId: task.characterId ?? "",
				},
				context,
			);
	}
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
		result.push(resolveInputAsset("image", image, options));
	}
	if (task.inputs?.mask) {
		result.push(resolveInputAsset("mask", task.inputs.mask, options));
	}
	if (task.inputs?.inputReference) {
		result.push(
			resolveInputAsset("reference", task.inputs.inputReference, options),
		);
	}
	if (task.inputs?.video) {
		result.push(resolveInputAsset("video", task.inputs.video, options));
	}
	for (const video of task.inputs?.videos ?? []) {
		result.push(resolveInputAsset("video", video, options));
	}
	return result;
}

function resolveInputAsset(
	role: AssetInput["role"],
	ref: z.infer<typeof inputRefSchema>,
	options: {
		baseDir: string;
		completed: Map<string, JobResult>;
	},
): AssetInput {
	if (typeof ref === "string") {
		return {
			role,
			source: resolveInputRef(ref, options),
		};
	}
	return {
		role,
		source: resolveInputRef(ref, options),
		mime: ref.mime,
		name: ref.name,
	};
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
