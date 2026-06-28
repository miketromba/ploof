import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { Auth } from "./auth";
import type { Config } from "./config";
import { getProvider } from "./providers/registry";
import {
	type AssetInput,
	type AssetJob,
	type BaseJob,
	type JobResult,
	OPERATION_KINDS,
	type OperationKind,
} from "./types";

const inputRefSchema = z.union([
	z.string(),
	z.object({
		source: z.string().optional(),
		task: z.string().optional(),
		mime: z.string().optional(),
		name: z.string().optional(),
	}),
]);

const inputValueSchema = z.union([inputRefSchema, z.array(inputRefSchema)]);

const taskSchema = z.object({
	id: z.string(),
	kind: z.enum(OPERATION_KINDS),
	provider: z.string().optional(),
	profile: z.string().optional(),
	needs: z.array(z.string()).default([]),
	model: z.string().optional(),
	prompt: z.string().optional(),
	text: z.string().optional(),
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
	inputs: z.record(z.string(), inputValueSchema).optional(),
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
			provider: taskProvider(task),
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
		if (task.kind === "audio.generate" && !task.text && !task.prompt) {
			throw new Error(`Task ${task.id} requires text.`);
		}
		if (
			task.kind === "model.run" &&
			!task.model &&
			typeof task.params.model !== "string"
		) {
			throw new Error(`Task ${task.id} requires model.`);
		}
		if (
			["audio.transcribe", "audio.translate"].includes(task.kind) &&
			!hasInputRole(task, "audio")
		) {
			throw new Error(`Task ${task.id} requires inputs.audio.`);
		}
		if (task.kind === "image.variation" && !hasInputRole(task, "image")) {
			throw new Error(`Task ${task.id} requires inputs.images.`);
		}
		if (
			["video.edit", "video.extend"].includes(task.kind) &&
			!task.videoId &&
			!hasInputRole(task, "video")
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
			if (!hasInputRole(task, "video")) {
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

function hasInputRole(task: ManifestTask, role: AssetInput["role"]): boolean {
	for (const [key, value] of Object.entries(task.inputs ?? {})) {
		if (inputRoleFromKey(key) !== role) continue;
		const values = Array.isArray(value) ? value : [value];
		if (values.length > 0) return true;
	}
	return false;
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
	const providerId = taskProvider(task);
	const provider = getProvider(providerId);
	const credential = options.auth.getCredential(providerId, task.profile);
	if (!credential?.apiKey) {
		throw new Error(
			`No credentials found for ${providerId}. Run 'ploof login ${providerId}'.`,
		);
	}

	const base = {
		id: task.id,
		kind: task.kind as OperationKind,
		provider: providerId,
		profile: task.profile,
		prompt: task.prompt ?? "",
		params: task.params,
		output: task.output
			? resolveMaybe(options.baseDir, task.output)
			: undefined,
		sidecar: task.sidecar ?? options.sidecar,
	};

	const inputs = resolveInputs(task, options);
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
	const job = buildTaskJob(task, base, inputs, lifecycle);
	return provider.run(job, context);
}

function taskProvider(task: ManifestTask): string {
	return task.provider ?? (task.kind === "model.run" ? "fal" : "openai");
}

function buildTaskJob(
	task: ManifestTask,
	base: BaseJob,
	inputs: AssetInput[],
	lifecycle: {
		wait: boolean | undefined;
		download: boolean | undefined;
		variants: Array<"video" | "thumbnail" | "spritesheet"> | undefined;
		pollIntervalMs: number | undefined;
		timeoutMs: number | undefined;
	},
): AssetJob {
	switch (task.kind) {
		case "model.run":
			return {
				...base,
				kind: "model.run",
				model: task.model ?? String(task.params.model ?? ""),
				inputs,
			};
		case "image.generate":
			return { ...base, kind: "image.generate", prompt: base.prompt ?? "" };
		case "image.variation":
			return { ...base, kind: "image.variation", inputs };
		case "image.edit":
			return {
				...base,
				kind: "image.edit",
				prompt: base.prompt ?? "",
				inputs,
			};
		case "video.generate":
			return {
				...base,
				kind: "video.generate",
				prompt: base.prompt ?? "",
				inputs,
				...lifecycle,
			};
		case "video.edit":
			return {
				...base,
				kind: "video.edit",
				prompt: base.prompt ?? "",
				inputs,
				videoId: task.videoId,
				...lifecycle,
			};
		case "video.extend":
			return {
				...base,
				kind: "video.extend",
				prompt: base.prompt ?? "",
				inputs,
				videoId: task.videoId,
				...lifecycle,
			};
		case "video.remix":
			return {
				...base,
				kind: "video.remix",
				prompt: base.prompt ?? "",
				videoId: task.videoId ?? "",
				...lifecycle,
			};
		case "video.status":
			return { ...base, kind: "video.status", videoId: task.videoId ?? "" };
		case "video.download":
			return {
				...base,
				kind: "video.download",
				videoId: task.videoId ?? "",
				variants: task.variants ?? ["video"],
			};
		case "video.list":
			return { ...base, kind: "video.list" };
		case "video.delete":
			return { ...base, kind: "video.delete", videoId: task.videoId ?? "" };
		case "video.character.create":
			return {
				...base,
				kind: "video.character.create",
				name: task.name ?? "",
				inputs,
			};
		case "video.character.get":
			return {
				...base,
				kind: "video.character.get",
				characterId: task.characterId ?? "",
			};
		case "audio.generate":
			return {
				...base,
				kind: "audio.generate",
				input: task.text ?? task.prompt ?? "",
			};
		case "audio.transcribe":
			return { ...base, kind: "audio.transcribe", inputs };
		case "audio.translate":
			return { ...base, kind: "audio.translate", inputs };
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
	for (const [key, value] of Object.entries(task.inputs ?? {})) {
		const role = inputRoleFromKey(key);
		const values = Array.isArray(value) ? value : [value];
		for (const ref of values) {
			result.push(resolveInputAsset(role, ref, options));
		}
	}
	return result;
}

function inputRoleFromKey(key: string): AssetInput["role"] {
	const aliases: Record<string, AssetInput["role"]> = {
		image: "image",
		images: "image",
		mask: "mask",
		reference: "reference",
		references: "reference",
		inputReference: "reference",
		style: "style",
		styles: "style",
		audio: "audio",
		video: "video",
		videos: "video",
	};
	return aliases[key] ?? key;
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
