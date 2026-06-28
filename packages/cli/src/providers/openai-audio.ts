import type OpenAI from "openai";
import {
	assetToUploadable,
	saveResponseToFile,
	saveTextData,
	writeSidecar,
} from "../assets";
import type {
	AssetInput,
	AudioGenerateJob,
	AudioTranscribeJob,
	AudioTranslateJob,
	JobResult,
	ProviderContext,
} from "../types";

const DEFAULT_OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
const DEFAULT_OPENAI_TTS_VOICE = "alloy";
const DEFAULT_OPENAI_TTS_FORMAT = "mp3";
const DEFAULT_OPENAI_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
const DEFAULT_OPENAI_TRANSCRIBE_FORMAT = "json";
const DEFAULT_OPENAI_TRANSLATE_MODEL = "whisper-1";
const DEFAULT_OPENAI_TRANSLATE_FORMAT = "json";

type AudioApi = {
	speech: {
		create(params: Record<string, unknown>): Promise<Response>;
	};
	transcriptions: {
		create(
			params: Record<string, unknown>,
		): Promise<unknown> | AsyncIterable<unknown>;
	};
	translations: {
		create(params: Record<string, unknown>): Promise<unknown>;
	};
};

export async function runOpenAIAudioGenerate(
	client: OpenAI,
	job: AudioGenerateJob,
	context: ProviderContext,
): Promise<JobResult> {
	const params = applyAudioGenerateDefaults({
		...job.params,
		input: job.input,
	});
	assertStaticSpeechParams(params);
	const response = await callOpenAIAudioPromiseApi("audio.generate", () =>
		audioApi(client).speech.create(params),
	);
	if (isEventStreamResponse(response)) {
		throw new Error(
			"OpenAI returned a streamed speech response. Ploof audio generation writes complete static audio files; omit stream_format or use stream_format=audio.",
		);
	}
	const format = audioOutputFormat(params.response_format);
	const output = await saveResponseToFile({
		response,
		output: job.output,
		index: 0,
		total: 1,
		format,
		defaultName: job.id ?? "speech",
	});
	const result: JobResult = {
		id: job.id,
		kind: "audio.generate",
		provider: "openai",
		profile: context.credential.profile,
		outputs: [output],
		metadata: {
			model: params.model,
			voice: params.voice,
			format,
		},
	};

	if (job.sidecar ?? context.sidecar ?? true) {
		await writeSidecar(result, { ...job, params }, "audio.generate");
	}

	return result;
}

export async function runOpenAIAudioTranscribe(
	client: OpenAI,
	job: AudioTranscribeJob,
	context: ProviderContext,
): Promise<JobResult> {
	const audioInput = firstInput(job.inputs, "audio");
	if (!audioInput) {
		throw new Error("An --audio input is required for audio transcription.");
	}
	const params = applyAudioTranscribeDefaults({
		...job.params,
		file: await assetToUploadable(audioInput),
	});
	assertStaticProcessingParams(params);
	const response = await callOpenAIAudioApi("audio.transcribe", () =>
		audioApi(client).transcriptions.create(params),
	);
	return persistAudioProcessingResult({
		kind: "audio.transcribe",
		job,
		context,
		response,
		params,
		defaultName: job.id ?? "transcript",
		defaultFormat: DEFAULT_OPENAI_TRANSCRIBE_FORMAT,
	});
}

export async function runOpenAIAudioTranslate(
	client: OpenAI,
	job: AudioTranslateJob,
	context: ProviderContext,
): Promise<JobResult> {
	const audioInput = firstInput(job.inputs, "audio");
	if (!audioInput) {
		throw new Error("An --audio input is required for audio translation.");
	}
	const params = applyAudioTranslateDefaults({
		...job.params,
		file: await assetToUploadable(audioInput),
	});
	const response = await callOpenAIAudioPromiseApi("audio.translate", () =>
		audioApi(client).translations.create(params),
	);
	return persistAudioProcessingResult({
		kind: "audio.translate",
		job,
		context,
		response,
		params,
		defaultName: job.id ?? "translation",
		defaultFormat: DEFAULT_OPENAI_TRANSLATE_FORMAT,
	});
}

function applyAudioGenerateDefaults(
	params: Record<string, unknown>,
): Record<string, unknown> {
	return {
		...params,
		model: params.model ?? DEFAULT_OPENAI_TTS_MODEL,
		voice: params.voice ?? DEFAULT_OPENAI_TTS_VOICE,
		response_format: params.response_format ?? DEFAULT_OPENAI_TTS_FORMAT,
	};
}

function applyAudioTranscribeDefaults(
	params: Record<string, unknown>,
): Record<string, unknown> {
	return {
		...params,
		model: params.model ?? DEFAULT_OPENAI_TRANSCRIBE_MODEL,
		response_format: params.response_format ?? DEFAULT_OPENAI_TRANSCRIBE_FORMAT,
	};
}

function applyAudioTranslateDefaults(
	params: Record<string, unknown>,
): Record<string, unknown> {
	return {
		...params,
		model: params.model ?? DEFAULT_OPENAI_TRANSLATE_MODEL,
		response_format: params.response_format ?? DEFAULT_OPENAI_TRANSLATE_FORMAT,
	};
}

async function persistAudioProcessingResult(options: {
	kind: "audio.transcribe" | "audio.translate";
	job: AudioTranscribeJob | AudioTranslateJob;
	context: ProviderContext;
	response: unknown;
	params: Record<string, unknown>;
	defaultName: string;
	defaultFormat: string;
}): Promise<JobResult> {
	const serialized = await serializeAudioProcessingResponse(options.response);
	const format = processingOutputFormat(
		options.params.response_format,
		serialized.format ?? options.defaultFormat,
	);
	const outputs = options.job.output
		? [
				await saveTextData({
					text: serialized.text,
					output: options.job.output,
					index: 0,
					total: 1,
					format,
					defaultName: options.defaultName,
				}),
			]
		: [];

	const result: JobResult = {
		id: options.job.id,
		kind: options.kind,
		provider: "openai",
		profile: options.context.credential.profile,
		outputs,
		metadata: {
			model: options.params.model,
			format,
			text: serialized.plainText,
			response: serialized.metadata,
		},
	};

	if (
		outputs.length > 0 &&
		(options.job.sidecar ?? options.context.sidecar ?? true)
	) {
		await writeSidecar(
			result,
			{ ...options.job, params: sidecarParams(options.params) },
			options.kind,
		);
	}

	return result;
}

async function serializeAudioProcessingResponse(response: unknown): Promise<{
	text: string;
	plainText?: string;
	format?: string;
	metadata: unknown;
}> {
	if (isAsyncIterable(response)) {
		throw new Error(
			"Streaming audio processing responses are not supported because Ploof writes complete static assets. Omit stream=true.",
		);
	}

	if (typeof response === "string") {
		return {
			text: response,
			plainText: response,
			format: "txt",
			metadata: { text: response },
		};
	}

	return {
		text: `${JSON.stringify(response, null, 2)}\n`,
		plainText: extractText(response),
		format: "json",
		metadata: response,
	};
}

function audioOutputFormat(value: unknown): string {
	return typeof value === "string" && value ? value : DEFAULT_OPENAI_TTS_FORMAT;
}

function processingOutputFormat(value: unknown, fallback: string): string {
	if (typeof value !== "string" || !value) return fallback;
	switch (value) {
		case "json":
		case "verbose_json":
		case "diarized_json":
			return "json";
		case "text":
			return "txt";
		case "srt":
		case "vtt":
			return value;
		default:
			return fallback;
	}
}

function assertStaticSpeechParams(params: Record<string, unknown>): void {
	if (params.stream_format === "sse") {
		throw new Error(
			"OpenAI stream_format=sse is not supported by Ploof audio generation because Ploof writes complete static audio files. Omit stream_format or use stream_format=audio.",
		);
	}
}

function assertStaticProcessingParams(params: Record<string, unknown>): void {
	if (params.stream === true || params.stream === "true") {
		throw new Error(
			"OpenAI stream=true is not supported by Ploof audio processing because Ploof writes complete static transcript assets. Omit stream=true.",
		);
	}
}

function isEventStreamResponse(response: Response): boolean {
	return (
		response.headers.get("content-type")?.includes("text/event-stream") === true
	);
}

async function callOpenAIAudioApi<T>(
	kind: string,
	operation: () => Promise<T> | AsyncIterable<T>,
): Promise<T | AsyncIterable<T>> {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof Error) throw error;
		throw new Error(`OpenAI ${kind} failed: ${String(error)}`);
	}
}

async function callOpenAIAudioPromiseApi<T>(
	kind: string,
	operation: () => Promise<T>,
): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof Error) throw error;
		throw new Error(`OpenAI ${kind} failed: ${String(error)}`);
	}
}

function audioApi(client: OpenAI): AudioApi {
	return client.audio as unknown as AudioApi;
}

function firstInput(
	inputs: AssetInput[],
	role: AssetInput["role"],
): AssetInput | undefined {
	return inputs.find((input) => input.role === role);
}

function extractText(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const text = (value as Record<string, unknown>).text;
	return typeof text === "string" ? text : undefined;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
	return Boolean(
		value && typeof value === "object" && Symbol.asyncIterator in value,
	);
}

function sidecarParams(
	params: Record<string, unknown>,
): Record<string, unknown> {
	const { file: _file, ...safeParams } = params;
	return safeParams;
}
