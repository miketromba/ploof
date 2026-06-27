import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PNG_1X1_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

type CapturedRequest = {
	method: string;
	path: string;
	contentType: string | null;
	body: string;
};

const servers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(() => {
	for (const server of servers.splice(0)) {
		server.stop(true);
	}
});

async function runCli(args: string[], env: Record<string, string>) {
	const proc = Bun.spawn(["bun", "run", "bin/ploof.ts", ...args], {
		env: {
			...process.env,
			...env,
			OPENAI_API_KEY: "",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, exitCode };
}

function startMockOpenAI(options: { variationStatus?: number } = {}) {
	const requests: CapturedRequest[] = [];
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			const body = await request.text();
			requests.push({
				method: request.method,
				path: url.pathname,
				contentType: request.headers.get("content-type"),
				body,
			});

			if (
				request.method !== "POST" ||
				!(
					url.pathname.endsWith("/images/generations") ||
					url.pathname.endsWith("/images/edits") ||
					url.pathname.endsWith("/images/variations")
				)
			) {
				return Response.json({ error: "not found" }, { status: 404 });
			}

			if (
				options.variationStatus &&
				url.pathname.endsWith("/images/variations")
			) {
				return new Response(null, { status: options.variationStatus });
			}

			return Response.json({
				created: 1_800_000_000,
				data: [
					{
						b64_json: PNG_1X1_BASE64,
						revised_prompt: "mock revised prompt",
					},
				],
				usage: {
					input_tokens: 1,
					output_tokens: 1,
					total_tokens: 2,
				},
			});
		},
	});
	servers.push(server);
	return {
		requests,
		baseURL: `http://127.0.0.1:${server.port}/v1`,
	};
}

function testEnv(home: string, baseURL: string): Record<string, string> {
	return {
		PLOOF_HOME: home,
		PLOOF_OPENAI_API_KEY: "sk-mock",
		PLOOF_OPENAI_BASE_URL: baseURL,
	};
}

describe("OpenAI mock end-to-end CLI", () => {
	test("generates an image file and sidecar metadata", async () => {
		const home = mkdtempSync(join(tmpdir(), "ploof-openai-home-"));
		const dir = mkdtempSync(join(tmpdir(), "ploof-openai-generate-"));
		const { baseURL, requests } = startMockOpenAI();
		const output = join(dir, "base.png");

		const result = await runCli(
			[
				"image",
				"generate",
				"--prompt",
				"mock red cube",
				"--model",
				"gpt-image-2",
				"--size",
				"1024x1024",
				"--format",
				"png",
				"--out",
				output,
				"--output",
				"json",
			],
			testEnv(home, baseURL),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(existsSync(output)).toBe(true);
		expect(existsSync(`${output}.json`)).toBe(true);

		const cliJson = JSON.parse(result.stdout);
		expect(cliJson.kind).toBe("image.generate");
		expect(cliJson.outputs).toEqual([output]);

		const sidecar = JSON.parse(readFileSync(`${output}.json`, "utf-8"));
		expect(sidecar.prompt).toBe("mock red cube");
		expect(sidecar.params.model).toBe("gpt-image-2");
		expect(sidecar.metadata.revisedPrompts).toEqual(["mock revised prompt"]);

		expect(requests).toHaveLength(1);
		expect(requests[0]?.path).toBe("/v1/images/generations");
		expect(requests[0]?.body).toContain("mock red cube");
	});

	test("defaults OpenAI image generation to gpt-image-2", async () => {
		const home = mkdtempSync(join(tmpdir(), "ploof-openai-home-"));
		const dir = mkdtempSync(join(tmpdir(), "ploof-openai-default-model-"));
		const { baseURL, requests } = startMockOpenAI();
		const output = join(dir, "base.png");

		const result = await runCli(
			[
				"image",
				"generate",
				"--prompt",
				"mock red cube",
				"--out",
				output,
				"--output",
				"json",
			],
			testEnv(home, baseURL),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");

		const sidecar = JSON.parse(readFileSync(`${output}.json`, "utf-8"));
		expect(sidecar.params.model).toBe("gpt-image-2");

		expect(requests).toHaveLength(1);
		expect(requests[0]?.body).toContain('"model":"gpt-image-2"');
	});

	test("rejects unsupported gpt-image-2 transparent backgrounds before API calls", async () => {
		const home = mkdtempSync(join(tmpdir(), "ploof-openai-home-"));
		const dir = mkdtempSync(join(tmpdir(), "ploof-openai-validation-"));
		const { baseURL, requests } = startMockOpenAI();

		const result = await runCli(
			[
				"image",
				"generate",
				"--prompt",
				"mock transparent cube",
				"--background",
				"transparent",
				"--out",
				join(dir, "base.png"),
			],
			testEnv(home, baseURL),
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"`background=transparent` is not supported by gpt-image-2",
		);
		expect(requests).toHaveLength(0);
	});

	test("edits an image with multipart upload and writes output", async () => {
		const home = mkdtempSync(join(tmpdir(), "ploof-openai-home-"));
		const dir = mkdtempSync(join(tmpdir(), "ploof-openai-edit-"));
		const { baseURL, requests } = startMockOpenAI();
		const input = join(dir, "input.png");
		const output = join(dir, "edit.png");
		writeFileSync(input, Buffer.from(PNG_1X1_BASE64, "base64"));

		const result = await runCli(
			[
				"image",
				"edit",
				"--image",
				input,
				"--prompt",
				"turn it blue",
				"--model",
				"gpt-image-2",
				"--format",
				"png",
				"--out",
				output,
				"--output",
				"json",
			],
			testEnv(home, baseURL),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(existsSync(output)).toBe(true);
		expect(existsSync(`${output}.json`)).toBe(true);

		const cliJson = JSON.parse(result.stdout);
		expect(cliJson.kind).toBe("image.edit");
		expect(cliJson.outputs).toEqual([output]);

		expect(requests).toHaveLength(1);
		expect(requests[0]?.path).toBe("/v1/images/edits");
		expect(requests[0]?.contentType).toContain("multipart/form-data");
		expect(requests[0]?.body).toContain("turn it blue");
	});

	test("creates image variations", async () => {
		const home = mkdtempSync(join(tmpdir(), "ploof-openai-home-"));
		const dir = mkdtempSync(join(tmpdir(), "ploof-openai-variation-"));
		const { baseURL, requests } = startMockOpenAI();
		const input = join(dir, "input.png");
		const output = join(dir, "variation.png");
		writeFileSync(input, Buffer.from(PNG_1X1_BASE64, "base64"));

		const result = await runCli(
			[
				"image",
				"variation",
				"--image",
				input,
				"--out",
				output,
				"--output",
				"json",
			],
			testEnv(home, baseURL),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(existsSync(output)).toBe(true);
		expect(existsSync(`${output}.json`)).toBe(true);

		const cliJson = JSON.parse(result.stdout);
		expect(cliJson.kind).toBe("image.variation");
		expect(cliJson.outputs).toEqual([output]);

		const sidecar = JSON.parse(readFileSync(`${output}.json`, "utf-8"));
		expect(sidecar.params.model).toBe("dall-e-2");

		expect(requests).toHaveLength(1);
		expect(requests[0]?.path).toBe("/v1/images/variations");
		expect(requests[0]?.contentType).toContain("multipart/form-data");
	});

	test("explains OpenAI variation 404s", async () => {
		const home = mkdtempSync(join(tmpdir(), "ploof-openai-home-"));
		const dir = mkdtempSync(join(tmpdir(), "ploof-openai-variation-"));
		const { baseURL, requests } = startMockOpenAI({ variationStatus: 404 });
		const input = join(dir, "input.png");
		const output = join(dir, "variation.png");
		writeFileSync(input, Buffer.from(PNG_1X1_BASE64, "base64"));

		const result = await runCli(
			[
				"image",
				"variation",
				"--image",
				input,
				"--out",
				output,
				"--output",
				"json",
			],
			testEnv(home, baseURL),
		);

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("OpenAI image variations returned 404");
		expect(result.stderr).toContain("only supports dall-e-2");
		expect(existsSync(output)).toBe(false);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.path).toBe("/v1/images/variations");
	});

	test("runs a dependency-aware manifest against the provider", async () => {
		const home = mkdtempSync(join(tmpdir(), "ploof-openai-home-"));
		const dir = mkdtempSync(join(tmpdir(), "ploof-openai-manifest-"));
		const { baseURL, requests } = startMockOpenAI();
		const manifest = join(dir, "assets.yaml");
		const base = join(dir, "assets/base.png");
		const edit = join(dir, "assets/edit.png");
		const variation = join(dir, "assets/variation.png");
		writeFileSync(
			manifest,
			[
				"version: 1",
				"parallel: 2",
				"tasks:",
				"  - id: base",
				"    kind: image.generate",
				"    provider: openai",
				"    prompt: mock base",
				"    params:",
				"      model: gpt-image-2",
				"    output: assets/base.png",
				"  - id: edit",
				"    kind: image.edit",
				"    provider: openai",
				"    needs: [base]",
				"    prompt: mock edit",
				"    params:",
				"      model: gpt-image-2",
				"    inputs:",
				"      images:",
				"        - task: base",
				"    output: assets/edit.png",
				"  - id: variation",
				"    kind: image.variation",
				"    provider: openai",
				"    needs: [base]",
				"    inputs:",
				"      images:",
				"        - task: base",
				"    output: assets/variation.png",
			].join("\n"),
		);

		const result = await runCli(
			["run", manifest, "--parallel", "2", "--output", "json"],
			testEnv(home, baseURL),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(existsSync(base)).toBe(true);
		expect(existsSync(edit)).toBe(true);
		expect(existsSync(variation)).toBe(true);
		expect(existsSync(`${base}.json`)).toBe(true);
		expect(existsSync(`${edit}.json`)).toBe(true);
		expect(existsSync(`${variation}.json`)).toBe(true);

		const cliJson = JSON.parse(result.stdout);
		expect(cliJson.map((item: { id: string }) => item.id)).toEqual([
			"base",
			"edit",
			"variation",
		]);
		expect(requests.map((request) => request.path)).toEqual([
			"/v1/images/generations",
			"/v1/images/edits",
			"/v1/images/variations",
		]);
	});
});
