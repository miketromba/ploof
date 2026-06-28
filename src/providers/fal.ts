import { extname } from "node:path";
import {
	createFalClient,
	type FalClient,
	type StorageSettings,
} from "@fal-ai/client";
import {
	mimeFromPath,
	resolveAssetInput,
	saveAssetData,
	saveResponseToFile,
	saveTextData,
	writeSidecar,
} from "../assets";
import type {
	AssetInput,
	AssetJob,
	AudioGenerateJob,
	AudioTranscribeJob,
	AudioTranslateJob,
	ImageEditJob,
	ImageGenerateJob,
	ImageVariationJob,
	JobResult,
	ModelRunJob,
	OperationKind,
	Provider,
	ProviderContext,
	VideoEditJob,
	VideoExtendJob,
	VideoGenerateJob,
} from "../types";

type FalSupportedJob =
	| ModelRunJob
	| ImageGenerateJob
	| ImageEditJob
	| ImageVariationJob
	| VideoGenerateJob
	| VideoEditJob
	| VideoExtendJob
	| AudioGenerateJob
	| AudioTranscribeJob
	| AudioTranslateJob;

type FalSubscribeOptions = {
	input?: Record<string, unknown>;
	method?: string;
	mode?: "polling";
	pollInterval?: number;
	timeout?: number;
	startTimeout?: number;
	priority?: "low" | "normal";
	logs?: boolean;
	storageSettings?: StorageSettings;
	onQueueUpdate?: (status: unknown) => void;
};

export interface FalClientLike {
	storage: {
		upload(
			file: Blob,
			options?: { lifecycle?: StorageSettings },
		): Promise<string>;
	};
	subscribe(
		endpointId: string,
		options: FalSubscribeOptions,
	): Promise<{ data: unknown; requestId: string }>;
}

export type FalClientFactory = (context: ProviderContext) => FalClientLike;

export class FalProvider implements Provider {
	id = "fal";
	displayName = "fal.ai";
	auth = {
		apiKeyEnvVars: ["PLOOF_FAL_KEY", "FAL_KEY"],
		apiKeyEnvPairs: [
			{ idEnvVar: "PLOOF_FAL_KEY_ID", secretEnvVar: "PLOOF_FAL_KEY_SECRET" },
			{ idEnvVar: "FAL_KEY_ID", secretEnvVar: "FAL_KEY_SECRET" },
		],
	} as const;
	capabilities = [
		"model.run",
		"image.generate",
		"image.edit",
		"image.variation",
		"video.generate",
		"video.edit",
		"video.extend",
		"audio.generate",
		"audio.transcribe",
		"audio.translate",
	] as const;

	constructor(
		private readonly createClient: FalClientFactory = createDefaultFalClient,
	) {}

	async run(job: AssetJob, context: ProviderContext): Promise<JobResult> {
		if (!(this.capabilities as readonly OperationKind[]).includes(job.kind)) {
			throw new Error(`fal.ai does not support ${job.kind}.`);
		}
		return this.runEndpoint(job as FalSupportedJob, context);
	}

	private async runEndpoint(
		job: FalSupportedJob,
		context: ProviderContext,
	): Promise<JobResult> {
		const endpoint = falEndpoint(job);
		const client = this.createClient(context);
		const storageSettings = storageSettingsFromParams(job.params);
		const input = await buildFalInput(job, client, storageSettings);
		const subscribeOptions = buildFalSubscribeOptions(
			job.params,
			input,
			storageSettings,
			context,
		);

		const response = await callFalEndpoint(endpoint, job.kind, () =>
			client.subscribe(endpoint, subscribeOptions),
		);
		const outputs = await persistFalResponse({
			data: response.data,
			job,
			endpoint,
		});

		const result: JobResult = {
			id: job.id ?? response.requestId,
			kind: job.kind,
			provider: this.id,
			profile: context.credential.profile,
			outputs,
			metadata: {
				model: endpoint,
				requestId: response.requestId,
				result: sanitizeMetadata(response.data),
			},
		};

		if (job.sidecar ?? context.sidecar ?? true) {
			await writeSidecar(
				result,
				{
					...job,
					params: {
						...job.params,
						model: endpoint,
					},
				},
				job.kind,
			);
		}

		return result;
	}
}

function createDefaultFalClient(context: ProviderContext): FalClientLike {
	if (!context.credential.apiKey) {
		throw new Error("fal.ai API key is required.");
	}
	return createFalClient({
		credentials: context.credential.apiKey,
	}) as FalClient as unknown as FalClientLike;
}

async function callFalEndpoint(
	endpoint: string,
	kind: OperationKind,
	operation: () => Promise<{ data: unknown; requestId: string }>,
): Promise<{ data: unknown; requestId: string }> {
	try {
		return await operation();
	} catch (error) {
		throw enrichFalError(endpoint, kind, error);
	}
}

function enrichFalError(
	endpoint: string,
	kind: OperationKind,
	error: unknown,
): Error {
	const status = getErrorStatus(error);
	const message = error instanceof Error ? error.message : String(error);
	const detail =
		status === 401 || status === 403
			? " Check the fal.ai API key, account credits, and endpoint access."
			: "";
	const enriched = new Error(
		`fal.ai ${kind} failed for ${endpoint}: ${message}.${detail}`,
	);
	(enriched as Error & { cause?: unknown }).cause = error;
	return enriched;
}

function getErrorStatus(error: unknown): number | undefined {
	if (!error || typeof error !== "object") return undefined;
	const candidate = error as Record<string, unknown>;
	const status = candidate.status ?? candidate.statusCode;
	return typeof status === "number" ? status : undefined;
}

function falEndpoint(job: FalSupportedJob): string {
	const model =
		job.kind === "model.run" ? job.model : stringParam(job.params, "model");
	if (!model) {
		throw new Error(
			`fal.ai ${job.kind} requires --model <endpoint-id> or params.model.`,
		);
	}
	return model;
}

async function buildFalInput(
	job: FalSupportedJob,
	client: FalClientLike,
	storageSettings: StorageSettings | undefined,
): Promise<Record<string, unknown>> {
	const input = stripFalControlParams(job.params);

	if ("prompt" in job && job.prompt && input.prompt === undefined) {
		input.prompt = job.prompt;
	}
	if (job.kind === "audio.generate" && input.text === undefined) {
		input.text = job.input;
	}
	if (
		(job.kind === "video.edit" || job.kind === "video.extend") &&
		job.videoId &&
		input.video_id === undefined
	) {
		input.video_id = job.videoId;
	}

	for (const asset of jobInputs(job)) {
		const value = await resolveFalInput(asset, client, storageSettings);
		const field =
			job.kind === "model.run"
				? asset.role
				: falFieldForRole(asset.role, job.kind);
		if (field) appendInputField(input, field, value);
	}

	return input;
}

function jobInputs(job: FalSupportedJob): AssetInput[] {
	return "inputs" in job ? job.inputs : [];
}

async function resolveFalInput(
	input: AssetInput,
	client: FalClientLike,
	storageSettings: StorageSettings | undefined,
): Promise<string> {
	if (isRemoteReference(input.source)) return input.source;

	const resolved = await resolveAssetInput(input);
	const blob = new Blob([Buffer.from(resolved.data)], {
		type: resolved.mime ?? mimeFromPath(resolved.fileName),
	});
	return client.storage.upload(
		blob,
		storageSettings ? { lifecycle: storageSettings } : undefined,
	);
}

function falFieldForRole(
	role: AssetInput["role"],
	kind: OperationKind,
): string | undefined {
	switch (role) {
		case "image":
			return kind === "image.variation" ? "image_url" : "image_url";
		case "reference":
			return "image_url";
		case "mask":
			return "mask_url";
		case "style":
			return "style_image_url";
		case "audio":
			return "audio_url";
		case "video":
			return "video_url";
		default:
			return undefined;
	}
}

function appendInputField(
	target: Record<string, unknown>,
	key: string,
	value: string,
): void {
	const existing = target[key];
	if (existing === undefined) {
		target[key] = value;
		return;
	}
	if (Array.isArray(existing)) {
		existing.push(value);
		return;
	}
	target[key] = [existing, value];
}

function buildFalSubscribeOptions(
	params: Record<string, unknown> | undefined,
	input: Record<string, unknown>,
	storageSettings: StorageSettings | undefined,
	context: ProviderContext,
): FalSubscribeOptions {
	const options: FalSubscribeOptions = {
		input,
		mode: "polling",
	};
	const method = stringParam(params, "method");
	if (method) options.method = method;

	const timeout =
		numberParam(params, "timeout_ms") ?? numberParam(params, "timeout");
	if (timeout !== undefined) options.timeout = timeout;

	const startTimeout =
		numberParam(params, "start_timeout") ?? numberParam(params, "startTimeout");
	if (startTimeout !== undefined) options.startTimeout = startTimeout;

	const pollInterval =
		numberParam(params, "poll_interval_ms") ??
		numberParam(params, "pollIntervalMs") ??
		numberParam(params, "poll_interval") ??
		numberParam(params, "pollInterval");
	if (pollInterval !== undefined) options.pollInterval = pollInterval;

	const priority = stringParam(params, "priority");
	if (priority) {
		if (priority !== "low" && priority !== "normal") {
			throw new Error("fal.ai priority must be low or normal.");
		}
		options.priority = priority;
	}

	const logs = booleanParam(params, "logs");
	if (logs !== undefined) options.logs = logs;

	if (storageSettings) options.storageSettings = storageSettings;

	if (context.verbose) {
		options.onQueueUpdate = (status) => {
			process.stderr.write(`fal queue ${JSON.stringify(status)}\n`);
		};
	}

	return options;
}

function stripFalControlParams(
	params: Record<string, unknown> | undefined,
): Record<string, unknown> {
	const {
		logs: _logs,
		method: _method,
		model: _model,
		poll_interval: _pollInterval,
		poll_interval_ms: _pollIntervalMs,
		pollInterval: _pollIntervalCamel,
		pollIntervalMs: _pollIntervalMsCamel,
		priority: _priority,
		start_timeout: _startTimeout,
		startTimeout: _startTimeoutCamel,
		storage_expires_in: _storageExpiresIn,
		storage_settings: _storageSettings,
		storageExpiresIn: _storageExpiresInCamel,
		storageSettings: _storageSettingsCamel,
		timeout: _timeout,
		timeout_ms: _timeoutMs,
		...input
	} = params ?? {};
	return { ...input };
}

function storageSettingsFromParams(
	params: Record<string, unknown> | undefined,
): StorageSettings | undefined {
	const raw =
		params?.storage_settings ??
		params?.storageSettings ??
		params?.storage_expires_in ??
		params?.storageExpiresIn;
	if (raw === undefined) return undefined;
	if (isPlainObject(raw)) return raw as StorageSettings;
	return { expiresIn: raw as StorageSettings["expiresIn"] };
}

async function persistFalResponse(options: {
	data: unknown;
	job: FalSupportedJob;
	endpoint: string;
}): Promise<string[]> {
	const assets = extractFalAssetItems(options.data);
	if (assets.length > 0) {
		return persistFalAssetItems(assets, options.job);
	}

	const textItems = extractFalTextItems(options.data);
	if (textItems.length > 0) {
		const outputs: string[] = [];
		for (let index = 0; index < textItems.length; index++) {
			outputs.push(
				await saveTextData({
					text: textItems[index]!,
					output: options.job.output,
					index,
					total: textItems.length,
					format: "txt",
					defaultName: defaultOutputName(options.job),
				}),
			);
		}
		return outputs;
	}

	return [
		await saveTextData({
			text: `${JSON.stringify(options.data, null, 2)}\n`,
			output: options.job.output,
			index: 0,
			total: 1,
			format: "json",
			defaultName: defaultOutputName(options.job),
		}),
	];
}

type FalAssetItem = {
	url?: string;
	data?: string | Uint8Array;
	format?: string;
};

async function persistFalAssetItems(
	items: FalAssetItem[],
	job: FalSupportedJob,
): Promise<string[]> {
	const outputs: string[] = [];
	for (let index = 0; index < items.length; index++) {
		const item = items[index]!;
		if (item.url) {
			const response = await fetch(item.url);
			const format =
				item.format ??
				formatFromContentType(response.headers.get("content-type")) ??
				formatFromUrl(item.url) ??
				defaultAssetFormat(job.kind);
			outputs.push(
				await saveResponseToFile({
					response,
					output: job.output,
					index,
					total: items.length,
					format,
					defaultName: defaultOutputName(job),
				}),
			);
			continue;
		}
		if (item.data !== undefined) {
			outputs.push(
				await saveAssetData({
					data: item.data,
					output: job.output,
					index,
					total: items.length,
					format: item.format ?? defaultAssetFormat(job.kind),
					defaultName: defaultOutputName(job),
				}),
			);
		}
	}
	return outputs;
}

function extractFalAssetItems(data: unknown): FalAssetItem[] {
	const result: FalAssetItem[] = [];
	const seenObjects = new WeakSet<object>();
	const seenValues = new Set<string>();

	const addUrl = (url: string, format?: string) => {
		if (seenValues.has(url)) return;
		seenValues.add(url);
		result.push({ url, format: format ?? formatFromUrl(url) });
	};

	const addData = (dataValue: string, format?: string) => {
		if (seenValues.has(dataValue)) return;
		seenValues.add(dataValue);
		result.push({ data: dataValue, format });
	};

	const visit = (value: unknown, keyHint?: string) => {
		if (typeof value === "string") {
			if (isAssetUrl(value)) addUrl(value);
			else if (isBase64AssetKey(keyHint)) addData(value);
			return;
		}
		if (!value || typeof value !== "object") return;
		if (seenObjects.has(value)) return;
		seenObjects.add(value);

		if (Array.isArray(value)) {
			for (const item of value) visit(item, keyHint);
			return;
		}

		const object = value as Record<string, unknown>;
		const declaredFormat =
			stringParam(object, "content_type") ??
			stringParam(object, "format") ??
			stringParam(object, "file_type") ??
			stringParam(object, "mime_type");
		const format = normalizeFormatHint(declaredFormat);

		const url =
			stringParam(object, "url") ??
			stringParam(object, "image_url") ??
			stringParam(object, "video_url") ??
			stringParam(object, "audio_url") ??
			stringParam(object, "file_url");
		if (url && isAssetUrl(url)) addUrl(url, format);

		const dataValue =
			stringParam(object, "b64_json") ??
			stringParam(object, "image_base64") ??
			stringParam(object, "audio_base64") ??
			stringParam(object, "video_base64") ??
			(format ? stringParam(object, "data") : undefined);
		if (dataValue) addData(dataValue, format);

		for (const [key, item] of Object.entries(object)) {
			if (isLikelyAssetKey(key)) visit(item, key);
		}
	};

	visit(data);
	return result;
}

function extractFalTextItems(data: unknown): string[] {
	const result: string[] = [];
	const seenObjects = new WeakSet<object>();

	const visit = (value: unknown, keyHint?: string) => {
		if (typeof value === "string") {
			if (isTextOutputKey(keyHint) && !isAssetUrl(value)) {
				result.push(value);
			}
			return;
		}
		if (!value || typeof value !== "object") return;
		if (seenObjects.has(value)) return;
		seenObjects.add(value);
		if (Array.isArray(value)) {
			for (const item of value) visit(item, keyHint);
			return;
		}
		for (const [key, item] of Object.entries(value)) {
			visit(item, key);
		}
	};

	visit(data, "output");
	return result.length > 0 ? result : typeof data === "string" ? [data] : [];
}

function defaultOutputName(job: FalSupportedJob): string {
	return (
		job.id ??
		(
			{
				"model.run": "result",
				"image.generate": "image",
				"image.edit": "edited-image",
				"image.variation": "variation",
				"video.generate": "video",
				"video.edit": "edited-video",
				"video.extend": "extended-video",
				"audio.generate": "audio",
				"audio.transcribe": "transcript",
				"audio.translate": "translation",
			} satisfies Record<FalSupportedJob["kind"], string>
		)[job.kind]
	);
}

function defaultAssetFormat(kind: OperationKind): string {
	if (kind.startsWith("image.")) return "png";
	if (kind.startsWith("video.")) return "mp4";
	if (kind === "audio.generate") return "mp3";
	return "bin";
}

function formatFromUrl(value: string): string | undefined {
	if (value.startsWith("data:")) {
		const mime = value.slice(5, value.indexOf(";"));
		return formatFromContentType(mime);
	}
	try {
		const url = new URL(value);
		const ext = extname(url.pathname).replace(/^\./, "").toLowerCase();
		return ext || undefined;
	} catch {
		return undefined;
	}
}

function formatFromContentType(
	value: string | null | undefined,
): string | undefined {
	if (!value) return undefined;
	const contentType = value.split(";")[0]?.trim().toLowerCase();
	switch (contentType) {
		case "image/jpeg":
			return "jpg";
		case "image/png":
			return "png";
		case "image/webp":
			return "webp";
		case "image/gif":
			return "gif";
		case "audio/mpeg":
			return "mp3";
		case "audio/mp4":
			return "m4a";
		case "audio/wav":
		case "audio/x-wav":
			return "wav";
		case "video/mp4":
			return "mp4";
		case "video/quicktime":
			return "mov";
		case "application/json":
			return "json";
		case "text/plain":
			return "txt";
		default:
			return contentType?.includes("/")
				? contentType
						.split("/")
						.pop()
						?.replace(/[^a-z0-9]/gi, "")
				: undefined;
	}
}

function normalizeFormatHint(value: string | undefined): string | undefined {
	if (!value) return undefined;
	if (value.includes("/")) return formatFromContentType(value);
	return value.replace(/^\./, "").toLowerCase();
}

function isRemoteReference(value: string): boolean {
	return (
		value.startsWith("http://") ||
		value.startsWith("https://") ||
		value.startsWith("data:")
	);
}

function isAssetUrl(value: string): boolean {
	if (value.startsWith("data:")) return true;
	if (!value.startsWith("http://") && !value.startsWith("https://")) {
		return false;
	}
	const format = formatFromUrl(value);
	return (
		Boolean(format) || value.includes("fal.media") || value.includes("fal.ai")
	);
}

function isLikelyAssetKey(key: string): boolean {
	return [
		"audio",
		"audio_url",
		"audios",
		"b64_json",
		"data",
		"file",
		"file_url",
		"files",
		"image",
		"image_url",
		"images",
		"output",
		"outputs",
		"result",
		"url",
		"video",
		"video_url",
		"videos",
	].includes(key);
}

function isBase64AssetKey(key: string | undefined): boolean {
	return Boolean(
		key &&
			["b64_json", "image_base64", "audio_base64", "video_base64"].includes(
				key,
			),
	);
}

function isTextOutputKey(key: string | undefined): boolean {
	return Boolean(
		key &&
			[
				"content",
				"output",
				"text",
				"transcript",
				"transcription",
				"translation",
			].includes(key),
	);
}

function stringParam(
	params: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = params?.[key];
	return typeof value === "string" && value.trim() ? value : undefined;
}

function numberParam(
	params: Record<string, unknown> | undefined,
	key: string,
): number | undefined {
	const value = params?.[key];
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function booleanParam(
	params: Record<string, unknown> | undefined,
	key: string,
): boolean | undefined {
	const value = params?.[key];
	return typeof value === "boolean" ? value : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sanitizeMetadata(
	value: unknown,
	seen = new WeakSet<object>(),
): unknown {
	if (typeof value === "string") {
		return value.length > 1024 ? `${value.slice(0, 1024)}...` : value;
	}
	if (!value || typeof value !== "object") return value;
	if (seen.has(value)) return "[Circular]";
	seen.add(value);
	if (Array.isArray(value))
		return value.map((item) => sanitizeMetadata(item, seen));
	const result: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		result[key] = sanitizeMetadata(item, seen);
	}
	return result;
}
