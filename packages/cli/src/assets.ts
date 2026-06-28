import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, parse } from "node:path";
import { toFile } from "openai";
import type { Uploadable } from "openai/uploads";
import type { AssetInput, JobResult, OperationKind } from "./types";

export interface ResolvedAssetInput extends AssetInput {
	data: Uint8Array;
	fileName: string;
}

export async function resolveAssetInput(
	input: AssetInput,
): Promise<ResolvedAssetInput> {
	if (input.source === "-") {
		const chunks: Uint8Array[] = [];
		for await (const chunk of process.stdin) {
			chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
		}
		const data = Buffer.concat(chunks);
		return {
			...input,
			data,
			fileName: input.name ?? `stdin${extensionForMime(input.mime)}`,
		};
	}

	if (isHttpUrl(input.source)) {
		const response = await fetch(input.source);
		if (!response.ok) {
			throw new Error(
				`Failed to fetch asset ${input.source}: ${response.status} ${response.statusText}`,
			);
		}
		const data = new Uint8Array(await response.arrayBuffer());
		const url = new URL(input.source);
		const fileName = (input.name ?? basename(url.pathname)) || "asset";
		return {
			...input,
			mime: input.mime ?? response.headers.get("content-type") ?? undefined,
			data,
			fileName,
		};
	}

	if (!existsSync(input.source)) {
		throw new Error(`Asset not found: ${input.source}`);
	}

	const data = await readFile(input.source);
	return {
		...input,
		mime: input.mime ?? mimeFromPath(input.source),
		data,
		fileName: input.name ?? basename(input.source),
	};
}

export async function assetToUploadable(
	input: AssetInput,
): Promise<Uploadable> {
	const resolved = await resolveAssetInput(input);
	return toFile(resolved.data, resolved.fileName, {
		type: resolved.mime ?? mimeFromPath(resolved.fileName),
	});
}

export function normalizeImageInputs(
	images: string[] | string | undefined,
	mask: string | undefined,
): AssetInput[] {
	const result: AssetInput[] = [];
	const imageList =
		images === undefined ? [] : Array.isArray(images) ? images : [images];
	for (const source of imageList) {
		result.push({
			role: "image",
			source,
			mime: mimeFromPath(source),
		});
	}
	if (mask) {
		result.push({
			role: "mask",
			source: mask,
			mime: mimeFromPath(mask),
		});
	}
	return result;
}

export async function saveImageData(options: {
	data: string | Uint8Array;
	output?: string;
	index: number;
	total: number;
	format?: string;
	defaultName: string;
}): Promise<string> {
	const format = normalizeImageFormat(options.format);
	return saveAssetData({ ...options, format });
}

export async function saveAssetData(options: {
	data: string | Uint8Array;
	output?: string;
	index: number;
	total: number;
	format: string;
	defaultName: string;
}): Promise<string> {
	const output = resolveAssetOutputPath(options);
	await mkdir(dirname(output), { recursive: true });
	const bytes =
		typeof options.data === "string"
			? Buffer.from(options.data, "base64")
			: Buffer.from(options.data);
	await writeFile(output, bytes);
	return output;
}

export async function downloadToFile(options: {
	url: string;
	output?: string;
	index: number;
	total: number;
	format?: string;
	defaultName: string;
}): Promise<string> {
	const response = await fetch(options.url);
	if (!response.ok) {
		throw new Error(
			`Failed to download generated asset: ${response.status} ${response.statusText}`,
		);
	}
	const data = new Uint8Array(await response.arrayBuffer());
	return saveImageData({ ...options, data });
}

export async function saveResponseToFile(options: {
	response: Response;
	output?: string;
	index: number;
	total: number;
	format: string;
	defaultName: string;
}): Promise<string> {
	if (!options.response.ok) {
		throw new Error(
			`Failed to download generated asset: ${options.response.status} ${options.response.statusText}`,
		);
	}
	const data = new Uint8Array(await options.response.arrayBuffer());
	return saveAssetData({ ...options, data });
}

export async function saveTextData(options: {
	text: string;
	output?: string;
	index: number;
	total: number;
	format: string;
	defaultName: string;
}): Promise<string> {
	return saveAssetData({
		...options,
		data: Buffer.from(options.text),
	});
}

export async function writeSidecar(
	result: JobResult,
	job: {
		prompt?: string;
		params?: Record<string, unknown>;
		sidecar?: boolean;
	},
	operation: OperationKind,
): Promise<void> {
	for (const output of result.outputs) {
		const sidecarPath = `${output}.json`;
		const body = {
			...result,
			operation,
			prompt: job.prompt,
			params: job.params ?? {},
			output,
			createdAt: new Date().toISOString(),
		};
		await writeFile(sidecarPath, `${JSON.stringify(body, null, 2)}\n`);
	}
}

export function mimeFromPath(path: string): string | undefined {
	const ext = extname(path).toLowerCase();
	switch (ext) {
		case ".png":
			return "image/png";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".webp":
			return "image/webp";
		case ".gif":
			return "image/gif";
		case ".mp3":
			return "audio/mpeg";
		case ".mpeg":
		case ".mpga":
			return "audio/mpeg";
		case ".m4a":
			return "audio/mp4";
		case ".wav":
			return "audio/wav";
		case ".flac":
			return "audio/flac";
		case ".ogg":
			return "audio/ogg";
		case ".opus":
			return "audio/opus";
		case ".aac":
			return "audio/aac";
		case ".webm":
			return "audio/webm";
		case ".mp4":
			return "video/mp4";
		case ".mov":
			return "video/quicktime";
		default:
			return undefined;
	}
}

function normalizeImageFormat(format: string | undefined): string {
	if (!format) return "png";
	return format.replace(/^\./, "").toLowerCase();
}

export function resolveAssetOutputPath(options: {
	output?: string;
	index: number;
	total: number;
	format: string;
	defaultName: string;
}): string {
	const output = options.output;
	if (!output) {
		return join(
			process.cwd(),
			`${options.defaultName}${suffix(options.index, options.total)}.${options.format}`,
		);
	}

	if (output.endsWith("/") || (existsSync(output) && isDirectory(output))) {
		return join(
			output,
			`${options.defaultName}${suffix(options.index, options.total)}.${options.format}`,
		);
	}

	if (options.total <= 1) return output;

	const parsed = parse(output);
	return join(
		parsed.dir,
		`${parsed.name}-${options.index + 1}${parsed.ext || `.${options.format}`}`,
	);
}

function suffix(index: number, total: number): string {
	return total <= 1 ? "" : `-${index + 1}`;
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function isHttpUrl(value: string): boolean {
	return value.startsWith("http://") || value.startsWith("https://");
}

function extensionForMime(mime: string | undefined): string {
	if (!mime) return "";
	switch (mime) {
		case "image/png":
			return ".png";
		case "image/jpeg":
			return ".jpg";
		case "image/webp":
			return ".webp";
		case "video/mp4":
			return ".mp4";
		case "video/quicktime":
			return ".mov";
		case "audio/mpeg":
			return ".mp3";
		case "audio/mp4":
			return ".m4a";
		case "audio/wav":
			return ".wav";
		case "audio/flac":
			return ".flac";
		case "audio/ogg":
			return ".ogg";
		case "audio/opus":
			return ".opus";
		case "audio/aac":
			return ".aac";
		case "audio/webm":
			return ".webm";
		default:
			return "";
	}
}
