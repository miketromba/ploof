import type OpenAI from "openai";
import { assetToUploadable, saveResponseToFile, writeSidecar } from "../assets";
import type {
	AssetInput,
	JobResult,
	ProviderContext,
	VideoCharacterCreateJob,
	VideoCharacterGetJob,
	VideoDeleteJob,
	VideoDownloadJob,
	VideoDownloadVariant,
	VideoEditJob,
	VideoExtendJob,
	VideoGenerateJob,
	VideoListJob,
	VideoRemixJob,
	VideoStatusJob,
} from "../types";

const DEFAULT_OPENAI_VIDEO_MODEL = "sora-2";
const DEFAULT_VIDEO_POLL_INTERVAL_MS = 10_000;
const DEFAULT_VIDEO_TIMEOUT_MS = 15 * 60_000;
const TERMINAL_VIDEO_STATUSES = new Set(["completed", "failed", "expired"]);

type VideoApi = {
	create(params: Record<string, unknown>): Promise<unknown>;
	retrieve(videoId: string): Promise<unknown>;
	list(params: Record<string, unknown>): Promise<unknown>;
	delete(videoId: string): Promise<unknown>;
	createCharacter(params: Record<string, unknown>): Promise<unknown>;
	downloadContent(
		videoId: string,
		params?: Record<string, unknown>,
	): Promise<Response>;
	edit(params: Record<string, unknown>): Promise<unknown>;
	extend(params: Record<string, unknown>): Promise<unknown>;
	getCharacter(characterId: string): Promise<unknown>;
	remix(videoId: string, params: Record<string, unknown>): Promise<unknown>;
};

type VideoLifecycleJob =
	| VideoGenerateJob
	| VideoEditJob
	| VideoExtendJob
	| VideoRemixJob;

export async function runOpenAIVideoGenerate(
	client: OpenAI,
	job: VideoGenerateJob,
	context: ProviderContext,
): Promise<JobResult> {
	const params = await buildVideoCreateParams(job);
	const submitted = await callOpenAIVideoApi("video.generate", () =>
		videoApi(client).create(params),
	);
	return persistVideoLifecycleResult(client, job, context, submitted, params);
}

export async function runOpenAIVideoEdit(
	client: OpenAI,
	job: VideoEditJob,
	context: ProviderContext,
): Promise<JobResult> {
	const params = await buildVideoMutationParams(job);
	const submitted = await callOpenAIVideoApi("video.edit", () =>
		videoApi(client).edit(params),
	);
	return persistVideoLifecycleResult(client, job, context, submitted, params);
}

export async function runOpenAIVideoExtend(
	client: OpenAI,
	job: VideoExtendJob,
	context: ProviderContext,
): Promise<JobResult> {
	const params = await buildVideoMutationParams(job);
	const submitted = await callOpenAIVideoApi("video.extend", () =>
		videoApi(client).extend(params),
	);
	return persistVideoLifecycleResult(client, job, context, submitted, params);
}

export async function runOpenAIVideoRemix(
	client: OpenAI,
	job: VideoRemixJob,
	context: ProviderContext,
): Promise<JobResult> {
	const params = compactObject({
		...job.params,
		prompt: job.prompt,
	});
	const submitted = await callOpenAIVideoApi("video.remix", () =>
		videoApi(client).remix(job.videoId, params),
	);
	return persistVideoLifecycleResult(client, job, context, submitted, params);
}

export async function runOpenAIVideoStatus(
	client: OpenAI,
	job: VideoStatusJob,
	context: ProviderContext,
): Promise<JobResult> {
	const video = await callOpenAIVideoApi("video.status", () =>
		videoApi(client).retrieve(job.videoId),
	);
	return {
		id: job.id,
		kind: "video.status",
		provider: "openai",
		profile: context.credential.profile,
		outputs: [],
		metadata: { video },
	};
}

export async function runOpenAIVideoDownload(
	client: OpenAI,
	job: VideoDownloadJob,
	context: ProviderContext,
): Promise<JobResult> {
	const outputs = await downloadVideoVariants({
		client,
		videoId: job.videoId,
		output: job.output,
		variants: job.variants,
	});
	const result: JobResult = {
		id: job.id,
		kind: "video.download",
		provider: "openai",
		profile: context.credential.profile,
		outputs,
		metadata: {
			videoId: job.videoId,
			variants: job.variants,
		},
	};
	if (job.sidecar ?? context.sidecar ?? true) {
		await writeSidecar(
			result,
			{ ...job, params: job.params },
			"video.download",
		);
	}
	return result;
}

export async function runOpenAIVideoList(
	client: OpenAI,
	job: VideoListJob,
	context: ProviderContext,
): Promise<JobResult> {
	const response = await callOpenAIVideoApi("video.list", () =>
		videoApi(client).list(job.params ?? {}),
	);
	return {
		id: job.id,
		kind: "video.list",
		provider: "openai",
		profile: context.credential.profile,
		outputs: [],
		metadata: normalizeListResponse(response),
	};
}

export async function runOpenAIVideoDelete(
	client: OpenAI,
	job: VideoDeleteJob,
	context: ProviderContext,
): Promise<JobResult> {
	const response = await callOpenAIVideoApi("video.delete", () =>
		videoApi(client).delete(job.videoId),
	);
	return {
		id: job.id,
		kind: "video.delete",
		provider: "openai",
		profile: context.credential.profile,
		outputs: [],
		metadata: { deleted: response },
	};
}

export async function runOpenAIVideoCharacterCreate(
	client: OpenAI,
	job: VideoCharacterCreateJob,
	context: ProviderContext,
): Promise<JobResult> {
	const videoInput = firstInput(job.inputs, "video");
	if (!videoInput) {
		throw new Error("A --video input is required to create a character.");
	}
	const params = {
		...job.params,
		name: job.name,
		video: await assetToUploadable(videoInput),
	};
	const response = await callOpenAIVideoApi("video.character.create", () =>
		videoApi(client).createCharacter(params),
	);
	return {
		id: job.id,
		kind: "video.character.create",
		provider: "openai",
		profile: context.credential.profile,
		outputs: [],
		metadata: { character: response },
	};
}

export async function runOpenAIVideoCharacterGet(
	client: OpenAI,
	job: VideoCharacterGetJob,
	context: ProviderContext,
): Promise<JobResult> {
	const response = await callOpenAIVideoApi("video.character.get", () =>
		videoApi(client).getCharacter(job.characterId),
	);
	return {
		id: job.id,
		kind: "video.character.get",
		provider: "openai",
		profile: context.credential.profile,
		outputs: [],
		metadata: { character: response },
	};
}

async function buildVideoCreateParams(
	job: VideoGenerateJob,
): Promise<Record<string, unknown>> {
	const params: Record<string, unknown> = compactObject({
		...job.params,
		model: job.params?.model ?? DEFAULT_OPENAI_VIDEO_MODEL,
		prompt: job.prompt,
	});
	const referenceInput = firstInput(job.inputs, "reference");
	if (referenceInput) {
		params.input_reference = await resolveInputReference(referenceInput);
	}
	return params;
}

async function buildVideoMutationParams(
	job: VideoEditJob | VideoExtendJob,
): Promise<Record<string, unknown>> {
	const sourceVideo = await resolveSourceVideo(job);
	const params: Record<string, unknown> = compactObject({
		...job.params,
		prompt: job.prompt,
		video: sourceVideo,
	});
	if (!sourceVideo) {
		throw new Error("Provide --video-id or --video.");
	}
	if (isUploadableSource(sourceVideo) && params.model === undefined) {
		params.model = DEFAULT_OPENAI_VIDEO_MODEL;
	}
	return params;
}

async function resolveInputReference(input: AssetInput): Promise<unknown> {
	if (input.source.startsWith("file:")) {
		return { file_id: input.source.slice("file:".length) };
	}
	if (isLikelyOpenAIFileId(input.source)) {
		return { file_id: input.source };
	}
	if (isHttpUrl(input.source) || input.source.startsWith("data:")) {
		return { image_url: input.source };
	}
	return assetToUploadable(input);
}

async function resolveSourceVideo(
	job: VideoEditJob | VideoExtendJob,
): Promise<unknown> {
	if (job.videoId) return { id: job.videoId };
	const videoInput = firstInput(job.inputs, "video");
	return videoInput ? assetToUploadable(videoInput) : undefined;
}

async function persistVideoLifecycleResult(
	client: OpenAI,
	job: VideoLifecycleJob,
	context: ProviderContext,
	submitted: unknown,
	params: Record<string, unknown>,
): Promise<JobResult> {
	let video = submitted;
	const submittedId = getVideoId(submitted);
	const shouldWait = shouldWaitForVideo(job);
	if (shouldWait) {
		if (!submittedId) {
			throw new Error("OpenAI video response did not include a video id.");
		}
		video = await waitForVideo(client, submittedId, job);
		assertCompletedVideo(video);
	}

	const completedId = getVideoId(video) ?? submittedId;
	const outputs =
		shouldDownloadVideo(job) && completedId
			? await downloadVideoVariants({
					client,
					videoId: completedId,
					output: job.output,
					variants: job.variants ?? ["video"],
				})
			: [];

	const result: JobResult = {
		id: job.id,
		kind: job.kind,
		provider: "openai",
		profile: context.credential.profile,
		outputs,
		metadata: {
			video,
			submitted,
			waited: shouldWait,
			downloaded: outputs.length > 0,
		},
	};

	if (outputs.length > 0 && (job.sidecar ?? context.sidecar ?? true)) {
		await writeSidecar(
			result,
			{ ...job, params: sidecarParams(params) },
			job.kind,
		);
	}

	return result;
}

async function waitForVideo(
	client: OpenAI,
	videoId: string,
	job: VideoLifecycleJob,
): Promise<unknown> {
	const startedAt = Date.now();
	const pollIntervalMs = job.pollIntervalMs ?? DEFAULT_VIDEO_POLL_INTERVAL_MS;
	const timeoutMs = job.timeoutMs ?? DEFAULT_VIDEO_TIMEOUT_MS;
	let video = await callOpenAIVideoApi("video.status", () =>
		videoApi(client).retrieve(videoId),
	);

	while (!TERMINAL_VIDEO_STATUSES.has(getVideoStatus(video))) {
		if (Date.now() - startedAt > timeoutMs) {
			throw new Error(
				`Timed out waiting for OpenAI video ${videoId} after ${timeoutMs}ms.`,
			);
		}
		await sleep(pollIntervalMs);
		video = await callOpenAIVideoApi("video.status", () =>
			videoApi(client).retrieve(videoId),
		);
	}

	return video;
}

function assertCompletedVideo(video: unknown): void {
	const status = getVideoStatus(video);
	if (status === "completed") return;
	const error = getVideoError(video);
	throw new Error(
		error
			? `OpenAI video generation failed: ${error}`
			: `OpenAI video generation ended with status=${status || "unknown"}.`,
	);
}

async function downloadVideoVariants(options: {
	client: OpenAI;
	videoId: string;
	output?: string;
	variants: VideoDownloadVariant[];
}): Promise<string[]> {
	const outputs: string[] = [];
	for (let index = 0; index < options.variants.length; index++) {
		const variant = options.variants[index]!;
		const response = await callOpenAIVideoApi("video.download", () =>
			videoApi(options.client).downloadContent(options.videoId, { variant }),
		);
		outputs.push(
			await saveResponseToFile({
				response,
				output: outputForVariant(
					options.output,
					variant,
					options.variants.length,
				),
				index: 0,
				total: 1,
				format: extensionForVariant(variant),
				defaultName: defaultNameForVariant(options.videoId, variant),
			}),
		);
	}
	return outputs;
}

function outputForVariant(
	output: string | undefined,
	variant: VideoDownloadVariant,
	total: number,
): string | undefined {
	if (!output || total <= 1 || output.endsWith("/")) return output;
	const dot = output.lastIndexOf(".");
	const slash = Math.max(output.lastIndexOf("/"), output.lastIndexOf("\\"));
	if (dot <= slash) {
		return `${output}-${variant}.${extensionForVariant(variant)}`;
	}
	return `${output.slice(0, dot)}-${variant}.${extensionForVariant(variant)}`;
}

function defaultNameForVariant(
	videoId: string,
	variant: VideoDownloadVariant,
): string {
	return variant === "video" ? videoId : `${videoId}-${variant}`;
}

function extensionForVariant(variant: VideoDownloadVariant): string {
	switch (variant) {
		case "thumbnail":
			return "webp";
		case "spritesheet":
			return "jpg";
		case "video":
			return "mp4";
	}
}

function shouldWaitForVideo(job: VideoLifecycleJob): boolean {
	return job.wait === true || Boolean(job.output) || job.download === true;
}

function shouldDownloadVideo(job: VideoLifecycleJob): boolean {
	return job.download === true || Boolean(job.output);
}

function getVideoId(video: unknown): string | undefined {
	return getString(video, "id");
}

function getVideoStatus(video: unknown): string {
	return getString(video, "status") ?? "";
}

function getVideoError(video: unknown): string | undefined {
	if (!video || typeof video !== "object") return undefined;
	const error = (video as Record<string, unknown>).error;
	if (!error || typeof error !== "object") return undefined;
	return getString(error, "message") ?? getString(error, "code");
}

function getString(value: unknown, key: string): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const item = (value as Record<string, unknown>)[key];
	return typeof item === "string" ? item : undefined;
}

function normalizeListResponse(response: unknown): Record<string, unknown> {
	const object =
		response && typeof response === "object"
			? (response as Record<string, unknown>)
			: {};
	return {
		data: object.data,
		has_more: object.has_more,
		first_id: object.first_id,
		last_id: object.last_id,
	};
}

function sidecarParams(
	params: Record<string, unknown>,
): Record<string, unknown> {
	const {
		input_reference: _inputReference,
		video: _video,
		...safeParams
	} = params;
	return safeParams;
}

async function callOpenAIVideoApi<T>(
	kind: string,
	operation: () => Promise<T>,
): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		throw enrichOpenAIVideoError(kind, error);
	}
}

function enrichOpenAIVideoError(kind: string, error: unknown): Error {
	if (error instanceof Error) return error;
	return new Error(`OpenAI ${kind} failed: ${String(error)}`);
}

function videoApi(client: OpenAI): VideoApi {
	return client.videos as unknown as VideoApi;
}

function firstInput(
	inputs: AssetInput[],
	role: AssetInput["role"],
): AssetInput | undefined {
	return inputs.find((input) => input.role === role);
}

function isUploadableSource(source: unknown): boolean {
	return Boolean(source && typeof source === "object" && "name" in source);
}

function isHttpUrl(value: string): boolean {
	return value.startsWith("http://") || value.startsWith("https://");
}

function isLikelyOpenAIFileId(value: string): boolean {
	return value.startsWith("file-") || value.startsWith("file_");
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactObject<T extends Record<string, unknown>>(object: T): T {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(object)) {
		if (value !== undefined) result[key] = value;
	}
	return result as T;
}
