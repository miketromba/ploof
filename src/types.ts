export type ProviderId = "openai" | string;

export type OperationKind =
	| "image.generate"
	| "image.edit"
	| "image.variation"
	| "video.generate"
	| "video.edit"
	| "video.extend"
	| "video.remix"
	| "video.status"
	| "video.download"
	| "video.list"
	| "video.delete"
	| "video.character.create"
	| "video.character.get"
	| "audio.generate"
	| "audio.transcribe"
	| "audio.translate";

export type VideoDownloadVariant = "video" | "thumbnail" | "spritesheet";

export type AssetRole =
	| "image"
	| "mask"
	| "reference"
	| "style"
	| "audio"
	| "video";

export interface AssetInput {
	role: AssetRole;
	source: string;
	mime?: string;
	name?: string;
}

export interface ProviderCredential {
	apiKey?: string;
	organization?: string;
	project?: string;
	baseURL?: string;
	source?: "env" | "stored";
	profile?: string;
}

export interface ProviderContext {
	credential: ProviderCredential;
	verbose?: boolean;
	sidecar?: boolean;
}

export interface BaseJob {
	id?: string;
	kind: OperationKind;
	provider: ProviderId;
	profile?: string;
	prompt?: string;
	params?: Record<string, unknown>;
	output?: string;
	sidecar?: boolean;
}

export interface ImageGenerateJob extends BaseJob {
	kind: "image.generate";
	prompt: string;
}

export interface ImageEditJob extends BaseJob {
	kind: "image.edit";
	prompt: string;
	inputs: AssetInput[];
}

export interface ImageVariationJob extends BaseJob {
	kind: "image.variation";
	inputs: AssetInput[];
}

export interface VideoGenerateJob extends BaseJob {
	kind: "video.generate";
	prompt: string;
	inputs: AssetInput[];
	wait?: boolean;
	download?: boolean;
	variants?: VideoDownloadVariant[];
	pollIntervalMs?: number;
	timeoutMs?: number;
}

export interface VideoEditJob extends BaseJob {
	kind: "video.edit";
	prompt: string;
	videoId?: string;
	inputs: AssetInput[];
	wait?: boolean;
	download?: boolean;
	variants?: VideoDownloadVariant[];
	pollIntervalMs?: number;
	timeoutMs?: number;
}

export interface VideoExtendJob extends BaseJob {
	kind: "video.extend";
	prompt: string;
	videoId?: string;
	inputs: AssetInput[];
	wait?: boolean;
	download?: boolean;
	variants?: VideoDownloadVariant[];
	pollIntervalMs?: number;
	timeoutMs?: number;
}

export interface VideoRemixJob extends BaseJob {
	kind: "video.remix";
	prompt: string;
	videoId: string;
	wait?: boolean;
	download?: boolean;
	variants?: VideoDownloadVariant[];
	pollIntervalMs?: number;
	timeoutMs?: number;
}

export interface VideoStatusJob extends BaseJob {
	kind: "video.status";
	videoId: string;
}

export interface VideoDownloadJob extends BaseJob {
	kind: "video.download";
	videoId: string;
	variants: VideoDownloadVariant[];
}

export interface VideoListJob extends BaseJob {
	kind: "video.list";
}

export interface VideoDeleteJob extends BaseJob {
	kind: "video.delete";
	videoId: string;
}

export interface VideoCharacterCreateJob extends BaseJob {
	kind: "video.character.create";
	name: string;
	inputs: AssetInput[];
}

export interface VideoCharacterGetJob extends BaseJob {
	kind: "video.character.get";
	characterId: string;
}

export interface AudioGenerateJob extends BaseJob {
	kind: "audio.generate";
	input: string;
}

export interface AudioTranscribeJob extends BaseJob {
	kind: "audio.transcribe";
	inputs: AssetInput[];
}

export interface AudioTranslateJob extends BaseJob {
	kind: "audio.translate";
	inputs: AssetInput[];
}

export type AssetJob =
	| ImageGenerateJob
	| ImageEditJob
	| ImageVariationJob
	| VideoGenerateJob
	| VideoEditJob
	| VideoExtendJob
	| VideoRemixJob
	| VideoStatusJob
	| VideoDownloadJob
	| VideoListJob
	| VideoDeleteJob
	| VideoCharacterCreateJob
	| VideoCharacterGetJob
	| AudioGenerateJob
	| AudioTranscribeJob
	| AudioTranslateJob;

export interface JobResult {
	id?: string;
	kind: OperationKind;
	provider: ProviderId;
	profile?: string;
	outputs: string[];
	metadata: Record<string, unknown>;
}

export interface Provider {
	id: ProviderId;
	capabilities: readonly OperationKind[];
	runImageGenerate(
		job: ImageGenerateJob,
		context: ProviderContext,
	): Promise<JobResult>;
	runImageEdit(job: ImageEditJob, context: ProviderContext): Promise<JobResult>;
	runImageVariation(
		job: ImageVariationJob,
		context: ProviderContext,
	): Promise<JobResult>;
	runVideoGenerate(
		job: VideoGenerateJob,
		context: ProviderContext,
	): Promise<JobResult>;
	runVideoEdit(job: VideoEditJob, context: ProviderContext): Promise<JobResult>;
	runVideoExtend(
		job: VideoExtendJob,
		context: ProviderContext,
	): Promise<JobResult>;
	runVideoRemix(
		job: VideoRemixJob,
		context: ProviderContext,
	): Promise<JobResult>;
	runVideoStatus(
		job: VideoStatusJob,
		context: ProviderContext,
	): Promise<JobResult>;
	runVideoDownload(
		job: VideoDownloadJob,
		context: ProviderContext,
	): Promise<JobResult>;
	runVideoList(job: VideoListJob, context: ProviderContext): Promise<JobResult>;
	runVideoDelete(
		job: VideoDeleteJob,
		context: ProviderContext,
	): Promise<JobResult>;
	runVideoCharacterCreate(
		job: VideoCharacterCreateJob,
		context: ProviderContext,
	): Promise<JobResult>;
	runVideoCharacterGet(
		job: VideoCharacterGetJob,
		context: ProviderContext,
	): Promise<JobResult>;
	runAudioGenerate(
		job: AudioGenerateJob,
		context: ProviderContext,
	): Promise<JobResult>;
	runAudioTranscribe(
		job: AudioTranscribeJob,
		context: ProviderContext,
	): Promise<JobResult>;
	runAudioTranslate(
		job: AudioTranslateJob,
		context: ProviderContext,
	): Promise<JobResult>;
}

export type OutputFormat = "table" | "compact" | "json" | "jsonl";

export interface OutputOptions {
	format: OutputFormat;
	fields?: string[];
	detail?: boolean;
	quiet?: boolean;
	noColor?: boolean;
}
