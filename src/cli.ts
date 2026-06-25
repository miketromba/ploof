import { Command } from "commander";
import { normalizeImageInputs } from "./assets";
import { Auth } from "./auth";
import { Config, type ConfigValues } from "./config";
import { CliError, formatError } from "./errors";
import { getLearnOutput } from "./learn";
import { runManifest } from "./manifest";
import { formatResult, resolveFormat } from "./output";
import { mergeObjects, parseJsonObject, parseParamAssignments } from "./params";
import { getProvider } from "./providers/registry";
import { installSkill } from "./skill";
import type {
	AssetJob,
	ImageEditJob,
	ImageGenerateJob,
	JobResult,
	OutputOptions,
} from "./types";

const VERSION = "0.1.1";

type CliOptions = Record<string, unknown> & {
	apiKey?: string;
	background?: string;
	baseUrl?: string;
	default?: boolean;
	detail?: boolean;
	dryRun?: boolean;
	fields?: string;
	format?: string;
	image?: string[];
	inputFidelity?: string;
	json?: string;
	mask?: string;
	model?: string;
	moderation?: string;
	n?: number;
	noColor?: boolean;
	organization?: string;
	out?: string;
	output?: string;
	outputCompression?: number;
	outputFormat?: string;
	parallel?: number;
	param?: string[];
	partialImages?: number;
	profile?: string;
	project?: string;
	prompt?: string;
	provider?: string;
	quality?: string;
	quiet?: boolean;
	responseFormat?: string;
	sidecar?: boolean;
	size?: string;
	stream?: boolean;
	style?: string;
	target?: string;
	user?: string;
	verbose?: boolean;
};

export function createProgram(): Command {
	const program = new Command()
		.name("ploof")
		.description(
			"AI asset generation CLI for images, audio, video, and provider-backed creative workflows",
		)
		.version(VERSION)
		.showSuggestionAfterError()
		.addHelpText(
			"after",
			`
Getting started:
  $ ploof login openai --api-key <your-api-key>
  $ ploof image generate --prompt "Studio product photo" --out assets/hero.png
  $ ploof learn

Use "ploof <command> --help" for more information about a command.`,
		);

	program
		.option(
			"-o, --output <format>",
			"Output format: auto|table|compact|json|jsonl",
		)
		.option("-f, --fields <list>", "Comma-separated field list")
		.option("-d, --detail", "Full detail view")
		.option("--no-color", "Disable color")
		.option("--verbose", "Debug output to stderr")
		.option("-q, --quiet", "Data only, no hints")
		.option("-y, --yes", "Skip confirmation prompts");

	registerConfig(program);
	registerAuth(program);
	registerImage(program);
	registerRun(program);
	registerLearn(program);
	registerSkill(program);

	program.configureOutput({
		writeErr: (str) => process.stderr.write(str),
		writeOut: (str) => process.stdout.write(str),
	});

	program.exitOverride((err) => {
		if (
			err.code === "commander.helpDisplayed" ||
			err.code === "commander.version"
		) {
			process.exit(0);
		}
		throw err;
	});

	return program;
}

function registerConfig(program: Command): void {
	const configCmd = program
		.command("config")
		.description("CLI configuration management")
		.addHelpText(
			"after",
			`
Examples:
  $ ploof config list
  $ ploof config get output
  $ ploof config set output compact
  $ ploof config reset`,
		);

	configCmd
		.command("list")
		.description("List all config values")
		.action(
			wrapAction(() => {
				const values = new Config().list();
				for (const [key, value] of Object.entries(values)) {
					process.stdout.write(`${key}=${JSON.stringify(value)}\n`);
				}
			}),
		);

	configCmd
		.command("get <key>")
		.description("Get a config value")
		.action(
			wrapAction((key: string) => {
				const config = new Config();
				process.stdout.write(
					`${JSON.stringify(getConfigValue(config, key))}\n`,
				);
			}),
		);

	configCmd
		.command("set <key> <value>")
		.description("Set a config value")
		.action(
			wrapAction((key: string, value: string) => {
				const config = new Config();
				setConfigValue(config, key, parseConfigValue(value));
				process.stdout.write(
					`Set ${key}=${JSON.stringify(getConfigValue(config, key))}\n`,
				);
			}),
		);

	configCmd
		.command("reset")
		.description("Reset to defaults")
		.action(
			wrapAction(() => {
				new Config().reset();
				process.stdout.write("Config reset to defaults.\n");
			}),
		);
}

function registerAuth(program: Command): void {
	addLoginCommand(program);
	addLogoutCommand(program);
	addWhoamiCommand(program);
	addProfilesCommand(program);
}

function addLoginCommand(parent: Command): void {
	parent
		.command("login <provider>")
		.description("Store provider credentials")
		.option("--api-key <key>", "Provider API key")
		.option("--profile <name>", "Profile name", "default")
		.option("--organization <id>", "OpenAI organization id")
		.option("--project <id>", "OpenAI project id")
		.option("--base-url <url>", "Provider base URL")
		.option("--no-default", "Do not set this profile as default")
		.action(
			wrapAction(async (provider: string, opts: CliOptions) => {
				if (provider !== "openai") {
					throw new CliError(`Unsupported provider for auth: ${provider}`, 2);
				}
				const profile = opts.profile ?? "default";
				const apiKey = await resolveLoginApiKey(provider, opts.apiKey);
				const auth = new Auth();
				auth.login(
					provider,
					profile,
					{
						apiKey,
						organization: opts.organization ?? process.env.PLOOF_OPENAI_ORG,
						project: opts.project ?? process.env.PLOOF_OPENAI_PROJECT,
						baseURL: opts.baseUrl ?? process.env.PLOOF_OPENAI_BASE_URL,
					},
					opts.default ?? true,
				);
				process.stdout.write(`Authenticated ${provider} profile=${profile}.\n`);
			}),
		);
}

function addLogoutCommand(parent: Command): void {
	parent
		.command("logout <provider>")
		.description("Remove stored credentials")
		.option("--profile <name>", "Profile name")
		.action(
			wrapAction((provider: string, opts: CliOptions) => {
				const removed = new Auth().logout(provider, opts.profile);
				process.stdout.write(
					removed
						? `Logged out ${provider}${opts.profile ? ` profile=${opts.profile}` : ""}.\n`
						: `No stored credentials found for ${provider}.\n`,
				);
			}),
		);
}

function addWhoamiCommand(parent: Command): void {
	parent
		.command("whoami [provider]")
		.description("Show current auth state")
		.option("--profile <name>", "Profile name")
		.action(
			wrapAction((provider = "openai", opts: CliOptions) => {
				const status = new Auth().status(provider, opts.profile);
				if (!status.authenticated) {
					process.stdout.write(
						`Not authenticated: provider=${provider} profile=${status.profile}. Run 'ploof login ${provider}'.\n`,
					);
					return;
				}
				process.stdout.write(
					`${[
						`Authenticated: provider=${status.provider}`,
						`profile=${status.profile}`,
						`source=${status.source}`,
						`key=${status.keyPrefix}`,
						status.organization
							? `organization=${status.organization}`
							: undefined,
						status.project ? `project=${status.project}` : undefined,
						status.baseURL ? `baseURL=${status.baseURL}` : undefined,
					]
						.filter(Boolean)
						.join(" ")}\n`,
				);
			}),
		);
}

function addProfilesCommand(parent: Command): void {
	parent
		.command("profiles [provider]")
		.description("List stored auth profiles")
		.action(
			wrapAction((provider?: string) => {
				const profiles = new Auth().listProfiles(provider);
				if (Object.keys(profiles).length === 0) {
					process.stdout.write("No stored profiles.\n");
					return;
				}
				for (const [providerId, names] of Object.entries(profiles)) {
					process.stdout.write(`${providerId}: ${names.join(", ")}\n`);
				}
			}),
		);
}

async function resolveLoginApiKey(
	provider: string,
	apiKey?: string,
): Promise<string> {
	const explicitKey = apiKey?.trim();
	if (explicitKey) return explicitKey;

	const envKey = getAuthEnvApiKey(provider)?.trim();
	if (envKey) return envKey;

	const promptedKey = await promptSecret(`${provider} API key`);
	if (promptedKey) return promptedKey;

	throw new CliError(
		`API key is required. Pass --api-key <key>, set ${authEnvHint(
			provider,
		)}, or run this command in an interactive terminal.`,
		2,
	);
}

function getAuthEnvApiKey(provider: string): string | undefined {
	if (provider === "openai") {
		return process.env.PLOOF_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
	}
	return undefined;
}

function authEnvHint(provider: string): string {
	if (provider === "openai") return "PLOOF_OPENAI_API_KEY";
	return "the provider API key environment variable";
}

async function promptSecret(label: string): Promise<string | undefined> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) return undefined;
	if (typeof process.stdin.setRawMode !== "function") return undefined;

	return new Promise((resolve, reject) => {
		let value = "";
		const input = process.stdin;
		const wasRaw = input.isRaw;

		const cleanup = () => {
			input.off("data", onData);
			input.setRawMode(wasRaw);
			input.pause();
			process.stdout.write("\n");
		};

		const onData = (chunk: Buffer | string) => {
			for (const char of String(chunk)) {
				if (char === "\r" || char === "\n" || char === "\u0004") {
					cleanup();
					resolve(value.trim());
					return;
				}
				if (char === "\u0003") {
					cleanup();
					reject(new CliError("Login cancelled.", 130));
					return;
				}
				if (char === "\u007f" || char === "\b") {
					value = value.slice(0, -1);
					continue;
				}
				if (char >= " ") {
					value += char;
				}
			}
		};

		process.stdout.write(`${label}: `);
		input.setEncoding("utf8");
		input.resume();
		input.setRawMode(true);
		input.on("data", onData);
	});
}

function registerImage(program: Command): void {
	const imageCmd = program
		.command("image")
		.description("Generate and edit image assets");

	const generateCmd = imageCmd
		.command("generate")
		.description("Generate images")
		.requiredOption("--prompt <prompt>", "Image prompt")
		.option("--provider <provider>", "Provider id", "openai")
		.option("--profile <name>", "Auth profile")
		.option("--out <path>", "Output file or directory");

	addOpenAIImageOptions(generateCmd);

	generateCmd.action(
		wrapAction(async (opts: CliOptions, command: Command) => {
			const allOpts = { ...command.optsWithGlobals(), ...opts };
			const params = buildImageParams(allOpts);
			const job: ImageGenerateJob = {
				kind: "image.generate",
				provider: allOpts.provider ?? "openai",
				profile: allOpts.profile,
				prompt: allOpts.prompt ?? "",
				output: allOpts.out,
				params,
			};
			await runAndPrint(job, allOpts);
		}),
	);

	const editCmd = imageCmd
		.command("edit")
		.description("Edit images with optional context images and masks")
		.requiredOption("--prompt <prompt>", "Edit prompt")
		.option("--provider <provider>", "Provider id", "openai")
		.option("--profile <name>", "Auth profile")
		.option("--image <path>", "Input/context image path or URL", collect, [])
		.option("--mask <path>", "Mask image path or URL")
		.option("--out <path>", "Output file or directory");

	addOpenAIImageOptions(editCmd);
	editCmd.option("--input-fidelity <value>", "OpenAI input fidelity");

	editCmd.action(
		wrapAction(async (opts: CliOptions, command: Command) => {
			const allOpts = { ...command.optsWithGlobals(), ...opts };
			if (!allOpts.image || allOpts.image.length === 0) {
				throw new CliError("At least one --image is required.", 2);
			}
			const params = buildImageParams(allOpts);
			const job: ImageEditJob = {
				kind: "image.edit",
				provider: allOpts.provider ?? "openai",
				profile: allOpts.profile,
				prompt: allOpts.prompt ?? "",
				output: allOpts.out,
				params,
				inputs: normalizeImageInputs(allOpts.image, allOpts.mask),
			};
			await runAndPrint(job, allOpts);
		}),
	);
}

function registerRun(program: Command): void {
	program
		.command("run <manifest>")
		.description("Run a YAML or JSON asset generation manifest")
		.option("--parallel <count>", "Maximum concurrent tasks", parsePositiveInt)
		.option("--dry-run", "Validate and print planned tasks without API calls")
		.action(
			wrapAction(
				async (manifest: string, opts: CliOptions, command: Command) => {
					const allOpts = { ...command.optsWithGlobals(), ...opts };
					const config = new Config();
					const results = await runManifest(manifest, {
						parallel: allOpts.parallel ?? config.get("defaultParallel"),
						dryRun: allOpts.dryRun,
						config,
						verbose: allOpts.verbose,
					});
					printResults(results, allOpts);
				},
			),
		);
}

function registerLearn(program: Command): void {
	program
		.command("learn")
		.description("Print AI-agent instructions for this ploof version")
		.allowUnknownOption(false)
		.action(
			wrapAction(() => {
				process.stdout.write(getLearnOutput([]));
			}),
		);
}

function registerSkill(program: Command): void {
	const skillCmd = program.command("skill").description("Agent skill helpers");

	skillCmd
		.command("install")
		.description("Install the ploof bootstrap skill")
		.option("--target <dir>", "Skill directory target")
		.action(
			wrapAction((opts: CliOptions) => {
				const path = installSkill(opts.target);
				process.stdout.write(`Installed ploof bootstrap skill: ${path}\n`);
			}),
		);
}

function addOpenAIImageOptions(command: Command): void {
	command
		.option("--model <model>", "Image model")
		.option("--size <size>", "Image size")
		.option("--quality <quality>", "Image quality")
		.option("--format <format>", "Output image format")
		.option("--output-format <format>", "Provider output_format value")
		.option("--background <background>", "Background setting")
		.option("--moderation <moderation>", "Moderation setting")
		.option("--n <count>", "Number of images", parsePositiveInt)
		.option("--output-compression <number>", "Output compression", parseNumber)
		.option(
			"--partial-images <number>",
			"Number of partial images",
			parseNumber,
		)
		.option("--response-format <format>", "Provider response format")
		.option("--style <style>", "Image style")
		.option("--user <user>", "End-user identifier")
		.option("--stream", "Request streamed image events")
		.option("--param <key=value>", "Provider-specific parameter", collect, [])
		.option("--json <object>", "Provider-specific JSON object");
}

function buildImageParams(opts: CliOptions): Record<string, unknown> {
	const firstClass = compactObject({
		model: opts.model,
		size: opts.size,
		quality: opts.quality,
		output_format: opts.outputFormat ?? opts.format,
		background: opts.background,
		moderation: opts.moderation,
		n: opts.n,
		output_compression: opts.outputCompression,
		partial_images: opts.partialImages,
		response_format: opts.responseFormat,
		style: opts.style,
		user: opts.user,
		stream: opts.stream,
		input_fidelity: opts.inputFidelity,
	});

	return mergeObjects(
		parseJsonObject(opts.json),
		firstClass,
		parseParamAssignments(opts.param),
	);
}

async function runAndPrint(job: AssetJob, opts: CliOptions): Promise<void> {
	const config = new Config();
	const auth = new Auth();
	const provider = getProvider(job.provider);
	const credential = auth.getCredential(job.provider, job.profile);
	if (!credential?.apiKey) {
		throw new CliError(
			`No credentials found for ${job.provider}. Run 'ploof login ${job.provider} --api-key <key>' or set PLOOF_OPENAI_API_KEY.`,
			1,
		);
	}

	const sidecar = config.get("sidecar");
	const result =
		job.kind === "image.generate"
			? await provider.runImageGenerate(job, {
					credential,
					verbose: opts.verbose,
					sidecar,
				})
			: await provider.runImageEdit(job, {
					credential,
					verbose: opts.verbose,
					sidecar,
				});

	printResults(result, opts);
}

function printResults(result: JobResult | JobResult[], opts: CliOptions): void {
	const config = new Config();
	const outputOptions = getOutputOptions(opts, config);
	const body = formatResult(result, outputOptions);
	if (body) process.stdout.write(`${body}\n`);
}

function getOutputOptions(opts: CliOptions, config: Config): OutputOptions {
	const format = resolveFormat(
		opts.output,
		config.get("output"),
		process.env.PLOOF_OUTPUT,
		process.stdout.isTTY ?? false,
	);
	return {
		format,
		fields:
			typeof opts.fields === "string"
				? opts.fields.split(",").map((field) => field.trim())
				: undefined,
		detail: opts.detail,
		quiet: opts.quiet,
		noColor: opts.noColor ?? config.get("noColor"),
	};
}

function wrapAction<T extends unknown[]>(
	fn: (...args: T) => void | Promise<void>,
): (...args: T) => Promise<void> {
	return async (...args: T) => {
		try {
			await fn(...args);
		} catch (err) {
			const globalOpts = findCommandOptions(args);
			process.stderr.write(
				`${formatError(err, globalOpts.noColor === true)}\n`,
			);
			process.exit(err instanceof CliError ? err.code : 1);
		}
	};
}

function findCommandOptions(args: unknown[]): Record<string, unknown> {
	for (const arg of args) {
		if (arg && typeof arg === "object" && "parent" in arg) {
			const command = arg as Command;
			return command.optsWithGlobals();
		}
	}
	return {};
}

function collect(value: string, previous: string[]): string[] {
	return [...previous, value];
}

function parsePositiveInt(value: string): number {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`Expected positive integer, received ${value}`);
	}
	return parsed;
}

function parseNumber(value: string): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		throw new Error(`Expected number, received ${value}`);
	}
	return parsed;
}

function parseConfigValue(value: string): unknown {
	if (value === "true") return true;
	if (value === "false") return false;
	if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
	return value;
}

function isConfigKey(key: string): key is keyof ConfigValues {
	return ["output", "defaultParallel", "sidecar", "noColor"].includes(key);
}

function getConfigValue(
	config: Config,
	key: string,
): ConfigValues[keyof ConfigValues] {
	if (!isConfigKey(key)) {
		throw new CliError(`Invalid config key: ${key}`, 2);
	}
	return config.get(key);
}

function setConfigValue(config: Config, key: string, value: unknown): void {
	if (!isConfigKey(key)) {
		throw new CliError(`Invalid config key: ${key}`, 2);
	}

	switch (key) {
		case "output":
			if (
				!["auto", "table", "compact", "json", "jsonl"].includes(String(value))
			) {
				throw new CliError(`Invalid output format: ${String(value)}`, 2);
			}
			config.set("output", String(value) as ConfigValues["output"]);
			return;
		case "defaultParallel":
			if (typeof value !== "number" || value <= 0) {
				throw new CliError("defaultParallel must be a positive number.", 2);
			}
			config.set("defaultParallel", value);
			return;
		case "sidecar":
		case "noColor":
			if (typeof value !== "boolean") {
				throw new CliError(`${key} must be true or false.`, 2);
			}
			config.set(key, value);
	}
}

function compactObject<T extends Record<string, unknown>>(object: T): T {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(object)) {
		if (value !== undefined) result[key] = value;
	}
	return result as T;
}
