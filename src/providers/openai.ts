import type OpenAI from "openai";
import {
	assetToUploadable,
	downloadToFile,
	saveImageData,
	writeSidecar,
} from "../assets";
import type {
	ImageEditJob,
	ImageGenerateJob,
	ImageVariationJob,
	JobResult,
	Provider,
	ProviderContext,
	VideoCharacterCreateJob,
	VideoCharacterGetJob,
	VideoDeleteJob,
	VideoDownloadJob,
	VideoEditJob,
	VideoExtendJob,
	VideoGenerateJob,
	VideoListJob,
	VideoRemixJob,
	VideoStatusJob,
} from "../types";
import { createOpenAIClient } from "./openai-client";
import {
	runOpenAIVideoCharacterCreate,
	runOpenAIVideoCharacterGet,
	runOpenAIVideoDelete,
	runOpenAIVideoDownload,
	runOpenAIVideoEdit,
	runOpenAIVideoExtend,
	runOpenAIVideoGenerate,
	runOpenAIVideoList,
	runOpenAIVideoRemix,
	runOpenAIVideoStatus,
} from "./openai-video";

const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-2";
const DEFAULT_OPENAI_VARIATION_MODEL = "dall-e-2";

type ImageDatum = {
	b64_json?: string;
	url?: string;
	revised_prompt?: string;
	[key: string]: unknown;
};

type ImagesApi = {
	createVariation(params: Record<string, unknown>): Promise<unknown>;
	generate(
		params: Record<string, unknown>,
	): Promise<unknown> | AsyncIterable<unknown>;
	edit(
		params: Record<string, unknown>,
	): Promise<unknown> | AsyncIterable<unknown>;
};

export class OpenAIProvider implements Provider {
	id = "openai";
	capabilities = [
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
	] as const;

	async runImageGenerate(
		job: ImageGenerateJob,
		context: ProviderContext,
	): Promise<JobResult> {
		const client = createClient(context);
		const params = applyOpenAIImageDefaults("image.generate", {
			...job.params,
			prompt: job.prompt,
		});
		validateOpenAIImageParams("image.generate", params);

		const response = await callOpenAIImageApi("image.generate", () =>
			imageApi(client).generate(params),
		);
		const outputs = await persistImageResponse({
			response,
			output: job.output,
			format: getFormat(params),
			defaultName: job.id ?? "image",
		});

		const result: JobResult = {
			id: job.id,
			kind: "image.generate",
			provider: this.id,
			profile: context.credential.profile,
			outputs,
			metadata: responseMetadata(response, params),
		};

		if (job.sidecar ?? context.sidecar ?? true) {
			await writeSidecar(
				result,
				{ ...job, params: sidecarParams(params) },
				"image.generate",
			);
		}

		return result;
	}

	async runImageEdit(
		job: ImageEditJob,
		context: ProviderContext,
	): Promise<JobResult> {
		const client = createClient(context);
		const imageInputs = job.inputs.filter((input) => input.role === "image");
		const maskInput = job.inputs.find((input) => input.role === "mask");
		if (imageInputs.length === 0) {
			throw new Error(
				"At least one --image input is required for image edits.",
			);
		}

		const images = await Promise.all(imageInputs.map(assetToUploadable));
		const mask = maskInput ? await assetToUploadable(maskInput) : undefined;
		const image = images.length === 1 ? images[0] : images;

		const params = applyOpenAIImageDefaults("image.edit", {
			...job.params,
			prompt: job.prompt,
			image,
			...(mask ? { mask } : {}),
		});
		validateOpenAIImageParams("image.edit", params);

		const response = await callOpenAIImageApi("image.edit", () =>
			imageApi(client).edit(params),
		);
		const outputs = await persistImageResponse({
			response,
			output: job.output,
			format: getFormat(params),
			defaultName: job.id ?? "edited-image",
		});

		const result: JobResult = {
			id: job.id,
			kind: "image.edit",
			provider: this.id,
			profile: context.credential.profile,
			outputs,
			metadata: responseMetadata(response, params),
		};

		if (job.sidecar ?? context.sidecar ?? true) {
			await writeSidecar(
				result,
				{ ...job, params: sidecarParams(params) },
				"image.edit",
			);
		}

		return result;
	}

	async runImageVariation(
		job: ImageVariationJob,
		context: ProviderContext,
	): Promise<JobResult> {
		const client = createClient(context);
		const imageInput = job.inputs.find((input) => input.role === "image");
		if (!imageInput) {
			throw new Error("An --image input is required for image variations.");
		}

		const image = await assetToUploadable(imageInput);
		const params = applyOpenAIImageDefaults("image.variation", {
			...job.params,
			image,
		});
		validateOpenAIImageParams("image.variation", params);

		const response = await callOpenAIImageApi("image.variation", () =>
			imageApi(client).createVariation(params),
		);
		const outputs = await persistImageResponse({
			response,
			output: job.output,
			format: getFormat(params),
			defaultName: job.id ?? "variation",
		});

		const result: JobResult = {
			id: job.id,
			kind: "image.variation",
			provider: this.id,
			profile: context.credential.profile,
			outputs,
			metadata: responseMetadata(response, params),
		};

		if (job.sidecar ?? context.sidecar ?? true) {
			await writeSidecar(
				result,
				{ ...job, params: sidecarParams(params) },
				"image.variation",
			);
		}

		return result;
	}

	async runVideoGenerate(
		job: VideoGenerateJob,
		context: ProviderContext,
	): Promise<JobResult> {
		return runOpenAIVideoGenerate(createClient(context), job, context);
	}

	async runVideoEdit(
		job: VideoEditJob,
		context: ProviderContext,
	): Promise<JobResult> {
		return runOpenAIVideoEdit(createClient(context), job, context);
	}

	async runVideoExtend(
		job: VideoExtendJob,
		context: ProviderContext,
	): Promise<JobResult> {
		return runOpenAIVideoExtend(createClient(context), job, context);
	}

	async runVideoRemix(
		job: VideoRemixJob,
		context: ProviderContext,
	): Promise<JobResult> {
		return runOpenAIVideoRemix(createClient(context), job, context);
	}

	async runVideoStatus(
		job: VideoStatusJob,
		context: ProviderContext,
	): Promise<JobResult> {
		return runOpenAIVideoStatus(createClient(context), job, context);
	}

	async runVideoDownload(
		job: VideoDownloadJob,
		context: ProviderContext,
	): Promise<JobResult> {
		return runOpenAIVideoDownload(createClient(context), job, context);
	}

	async runVideoList(
		job: VideoListJob,
		context: ProviderContext,
	): Promise<JobResult> {
		return runOpenAIVideoList(createClient(context), job, context);
	}

	async runVideoDelete(
		job: VideoDeleteJob,
		context: ProviderContext,
	): Promise<JobResult> {
		return runOpenAIVideoDelete(createClient(context), job, context);
	}

	async runVideoCharacterCreate(
		job: VideoCharacterCreateJob,
		context: ProviderContext,
	): Promise<JobResult> {
		return runOpenAIVideoCharacterCreate(createClient(context), job, context);
	}

	async runVideoCharacterGet(
		job: VideoCharacterGetJob,
		context: ProviderContext,
	): Promise<JobResult> {
		return runOpenAIVideoCharacterGet(createClient(context), job, context);
	}
}

function applyOpenAIImageDefaults(
	kind: "image.generate" | "image.edit" | "image.variation",
	params: Record<string, unknown>,
): Record<string, unknown> {
	return {
		...params,
		model:
			params.model ??
			(kind === "image.variation"
				? DEFAULT_OPENAI_VARIATION_MODEL
				: DEFAULT_OPENAI_IMAGE_MODEL),
	};
}

function validateOpenAIImageParams(
	kind: "image.generate" | "image.edit" | "image.variation",
	params: Record<string, unknown>,
): void {
	const model = typeof params.model === "string" ? params.model : undefined;
	if (kind === "image.variation" && model && model !== "dall-e-2") {
		throw new Error(
			"OpenAI image variations currently only support model=dall-e-2.",
		);
	}

	if (!model) return;
	if (isGptImageModel(model) && params.response_format !== undefined) {
		throw new Error(
			"`response_format` is only supported for DALL-E image models. GPT image models return base64 image data.",
		);
	}

	if (isGptImage2Model(model)) {
		if (params.background === "transparent") {
			throw new Error(
				"`background=transparent` is not supported by gpt-image-2. Use `background=auto` or `background=opaque`.",
			);
		}
		if (params.input_fidelity !== undefined) {
			throw new Error(
				"`input_fidelity` is not configurable for gpt-image-2; omit it because gpt-image-2 processes image inputs at high fidelity automatically.",
			);
		}
	}
}

async function callOpenAIImageApi(
	kind: "image.generate" | "image.edit" | "image.variation",
	operation: () => Promise<unknown> | AsyncIterable<unknown>,
): Promise<unknown> {
	try {
		return await operation();
	} catch (error) {
		throw enrichOpenAIImageError(kind, error);
	}
}

function enrichOpenAIImageError(
	kind: "image.generate" | "image.edit" | "image.variation",
	error: unknown,
): Error {
	const status = getErrorStatus(error);
	if (kind === "image.variation" && status === 404) {
		const enriched = new Error(
			"OpenAI image variations returned 404. The variations endpoint is legacy and only supports dall-e-2; this usually means the current API key or project cannot access that endpoint. Use `ploof image edit` for image-to-image workflows, or try a profile/project with DALL-E 2 variation access.",
		);
		(enriched as Error & { cause?: unknown }).cause = error;
		return enriched;
	}

	if (error instanceof Error) return error;
	return new Error(String(error));
}

function getErrorStatus(error: unknown): number | undefined {
	if (!error || typeof error !== "object") return undefined;
	const candidate = error as Record<string, unknown>;
	const status = candidate.status ?? candidate.statusCode;
	return typeof status === "number" ? status : undefined;
}

function sidecarParams(
	params: Record<string, unknown>,
): Record<string, unknown> {
	const { image: _image, mask: _mask, ...safeParams } = params;
	return safeParams;
}

function isGptImageModel(model: string): boolean {
	return model.startsWith("gpt-image-") || model === "chatgpt-image-latest";
}

function isGptImage2Model(model: string): boolean {
	return model === "gpt-image-2" || model.startsWith("gpt-image-2-");
}

function createClient(context: ProviderContext): OpenAI {
	return createOpenAIClient(context);
}

function imageApi(client: OpenAI): ImagesApi {
	return client.images as unknown as ImagesApi;
}

async function persistImageResponse(options: {
	response: unknown;
	output?: string;
	format?: string;
	defaultName: string;
}): Promise<string[]> {
	if (isAsyncIterable(options.response)) {
		return persistImageStream(options);
	}

	const data = extractData(options.response);
	const total = data.length;
	const outputs: string[] = [];

	for (let index = 0; index < data.length; index++) {
		const item = data[index]!;
		if (item.b64_json) {
			outputs.push(
				await saveImageData({
					data: item.b64_json,
					output: options.output,
					index,
					total,
					format: options.format,
					defaultName: options.defaultName,
				}),
			);
		} else if (item.url) {
			outputs.push(
				await downloadToFile({
					url: item.url,
					output: options.output,
					index,
					total,
					format: options.format,
					defaultName: options.defaultName,
				}),
			);
		}
	}

	if (outputs.length === 0) {
		throw new Error("OpenAI response did not include image data or URLs.");
	}

	return outputs;
}

async function persistImageStream(options: {
	response: unknown;
	output?: string;
	format?: string;
	defaultName: string;
}): Promise<string[]> {
	const images: string[] = [];
	for await (const event of options.response as AsyncIterable<unknown>) {
		images.push(...findBase64Images(event));
	}

	if (images.length === 0) {
		throw new Error("OpenAI stream did not include image data.");
	}

	const outputs: string[] = [];
	for (let index = 0; index < images.length; index++) {
		outputs.push(
			await saveImageData({
				data: images[index]!,
				output: options.output,
				index,
				total: images.length,
				format: options.format,
				defaultName: options.defaultName,
			}),
		);
	}
	return outputs;
}

function responseMetadata(
	response: unknown,
	params: Record<string, unknown> | undefined,
): Record<string, unknown> {
	const object =
		response && typeof response === "object"
			? (response as Record<string, unknown>)
			: {};
	return {
		model: params?.model,
		created: object.created,
		usage: object.usage,
		revisedPrompts: extractData(response)
			.map((item) => item.revised_prompt)
			.filter(Boolean),
	};
}

function extractData(response: unknown): ImageDatum[] {
	if (!response || typeof response !== "object") return [];
	const data = (response as { data?: unknown }).data;
	return Array.isArray(data) ? (data as ImageDatum[]) : [];
}

function findBase64Images(value: unknown): string[] {
	if (!value || typeof value !== "object") return [];
	const result: string[] = [];
	const visit = (node: unknown) => {
		if (!node || typeof node !== "object") return;
		for (const [key, item] of Object.entries(node as Record<string, unknown>)) {
			if (
				typeof item === "string" &&
				(key === "b64_json" ||
					key === "partial_image_b64" ||
					key === "image_b64")
			) {
				result.push(item);
			} else if (typeof item === "object") {
				visit(item);
			}
		}
	};
	visit(value);
	return result;
}

function getFormat(
	params: Record<string, unknown> | undefined,
): string | undefined {
	return (params?.output_format ?? params?.format) as string | undefined;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
	return Boolean(
		value && typeof value === "object" && Symbol.asyncIterator in value,
	);
}
