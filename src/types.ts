export type ProviderId = "openai" | string;

export type OperationKind = "image.generate" | "image.edit" | "image.variation";

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

export type AssetJob = ImageGenerateJob | ImageEditJob | ImageVariationJob;

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
}

export type OutputFormat = "table" | "compact" | "json" | "jsonl";

export interface OutputOptions {
	format: OutputFormat;
	fields?: string[];
	detail?: boolean;
	quiet?: boolean;
	noColor?: boolean;
}
