import OpenAI from "openai";
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
} from "../types";

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
	capabilities = ["image.generate", "image.edit", "image.variation"] as const;

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

		const response = await imageApi(client).generate(params);
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

		const response = await imageApi(client).edit(params);
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

		const response = await imageApi(client).createVariation(params);
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
	const credential = context.credential;
	if (!credential.apiKey) {
		throw new Error(
			"No OpenAI API key found. Run 'ploof login openai --api-key <key>' or set PLOOF_OPENAI_API_KEY.",
		);
	}

	return new OpenAI({
		apiKey: credential.apiKey,
		organization: credential.organization,
		project: credential.project,
		baseURL: credential.baseURL,
	});
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
