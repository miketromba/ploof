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
	JobResult,
	Provider,
	ProviderContext,
} from "../types";

type ImageDatum = {
	b64_json?: string;
	url?: string;
	revised_prompt?: string;
	[key: string]: unknown;
};

type ImagesApi = {
	generate(
		params: Record<string, unknown>,
	): Promise<unknown> | AsyncIterable<unknown>;
	edit(
		params: Record<string, unknown>,
	): Promise<unknown> | AsyncIterable<unknown>;
};

export class OpenAIProvider implements Provider {
	id = "openai";
	capabilities = ["image.generate", "image.edit"] as const;

	async runImageGenerate(
		job: ImageGenerateJob,
		context: ProviderContext,
	): Promise<JobResult> {
		const client = createClient(context);
		const params = {
			...job.params,
			prompt: job.prompt,
		};

		const response = await imageApi(client).generate(params);
		const outputs = await persistImageResponse({
			response,
			output: job.output,
			format: getFormat(job.params),
			defaultName: job.id ?? "image",
		});

		const result: JobResult = {
			id: job.id,
			kind: "image.generate",
			provider: this.id,
			profile: context.credential.profile,
			outputs,
			metadata: responseMetadata(response, job.params),
		};

		if (job.sidecar ?? context.sidecar ?? true) {
			await writeSidecar(result, job, "image.generate");
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

		const params = {
			...job.params,
			prompt: job.prompt,
			image,
			...(mask ? { mask } : {}),
		};

		const response = await imageApi(client).edit(params);
		const outputs = await persistImageResponse({
			response,
			output: job.output,
			format: getFormat(job.params),
			defaultName: job.id ?? "edited-image",
		});

		const result: JobResult = {
			id: job.id,
			kind: "image.edit",
			provider: this.id,
			profile: context.credential.profile,
			outputs,
			metadata: responseMetadata(response, job.params),
		};

		if (job.sidecar ?? context.sidecar ?? true) {
			await writeSidecar(result, job, "image.edit");
		}

		return result;
	}
}

function createClient(context: ProviderContext): OpenAI {
	const credential = context.credential;
	if (!credential.apiKey) {
		throw new Error(
			"No OpenAI API key found. Run 'ploof auth login openai --api-key <key>' or set PLOOF_OPENAI_API_KEY.",
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
	const outputs: string[] = [];
	let index = 0;
	for await (const event of options.response as AsyncIterable<unknown>) {
		for (const b64 of findBase64Images(event)) {
			outputs.push(
				await saveImageData({
					data: b64,
					output: options.output,
					index,
					total: 2,
					format: options.format,
					defaultName: options.defaultName,
				}),
			);
			index += 1;
		}
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
