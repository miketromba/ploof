import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PNG_1X1_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

type CapturedRequest = {
	method: string;
	path: string;
	search: string;
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
				search: url.search,
				contentType: request.headers.get("content-type"),
				body,
			});

			const audioResponse = mockAudioResponse(request, url, body);
			if (audioResponse) return audioResponse;

			const videoResponse = mockVideoResponse(request, url);
			if (videoResponse) return videoResponse;

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

function mockAudioResponse(
	request: Request,
	url: URL,
	body: string,
): Response | undefined {
	if (request.method === "POST" && url.pathname === "/v1/audio/speech") {
		return new Response("mock-mp3-audio", {
			headers: { "content-type": "audio/mpeg" },
		});
	}
	if (
		request.method === "POST" &&
		url.pathname === "/v1/audio/transcriptions"
	) {
		if (body.includes('name="response_format"') && body.includes("text")) {
			return new Response("mock transcript text", {
				headers: { "content-type": "text/plain" },
			});
		}
		return Response.json({
			text: "mock transcript text",
			usage: {
				type: "tokens",
				input_tokens: 1,
				output_tokens: 2,
				total_tokens: 3,
			},
		});
	}
	if (request.method === "POST" && url.pathname === "/v1/audio/translations") {
		if (body.includes('name="response_format"') && body.includes("text")) {
			return new Response("mock translated text", {
				headers: { "content-type": "text/plain" },
			});
		}
		return Response.json({
			text: "mock translated text",
		});
	}
	return undefined;
}

function mockVideoResponse(request: Request, url: URL): Response | undefined {
	const video = {
		id: "video_mock",
		object: "video",
		created_at: 1_800_000_000,
		completed_at: 1_800_000_010,
		expires_at: 1_800_086_400,
		status: "completed",
		model: "sora-2",
		progress: 100,
		prompt: "mock video",
		remixed_from_video_id: null,
		seconds: "4",
		size: "1280x720",
		error: null,
	};

	if (request.method === "POST" && url.pathname === "/v1/videos") {
		return Response.json({ ...video, status: "queued", progress: 0 });
	}
	if (request.method === "POST" && url.pathname === "/v1/videos/edits") {
		return Response.json({ ...video, id: "video_edit" });
	}
	if (request.method === "POST" && url.pathname === "/v1/videos/extensions") {
		return Response.json({ ...video, id: "video_extend", seconds: "8" });
	}
	if (
		request.method === "POST" &&
		url.pathname === "/v1/videos/video_mock/remix"
	) {
		return Response.json({
			...video,
			id: "video_remix",
			remixed_from_video_id: "video_mock",
		});
	}
	if (request.method === "GET" && url.pathname === "/v1/videos/video_mock") {
		return Response.json(video);
	}
	if (
		request.method === "GET" &&
		url.pathname === "/v1/videos/video_mock/content"
	) {
		const variant = url.searchParams.get("variant") ?? "video";
		const contentType =
			variant === "thumbnail"
				? "image/webp"
				: variant === "spritesheet"
					? "image/jpeg"
					: "video/mp4";
		return new Response(`mock-${variant}`, {
			headers: { "content-type": contentType },
		});
	}
	if (request.method === "GET" && url.pathname === "/v1/videos") {
		return Response.json({
			object: "list",
			data: [video],
			has_more: false,
			first_id: "video_mock",
			last_id: "video_mock",
		});
	}
	if (request.method === "DELETE" && url.pathname === "/v1/videos/video_mock") {
		return Response.json({
			id: "video_mock",
			object: "video.deleted",
			deleted: true,
		});
	}
	if (request.method === "POST" && url.pathname === "/v1/videos/characters") {
		return Response.json({
			id: "char_mock",
			created_at: 1_800_000_000,
			name: "Mossy",
		});
	}
	if (
		request.method === "GET" &&
		url.pathname === "/v1/videos/characters/char_mock"
	) {
		return Response.json({
			id: "char_mock",
			created_at: 1_800_000_000,
			name: "Mossy",
		});
	}
	return undefined;
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

	test("creates, polls, downloads, and sidecars a video", async () => {
		const home = mkdtempSync(join(tmpdir(), "ploof-openai-home-"));
		const dir = mkdtempSync(join(tmpdir(), "ploof-openai-video-"));
		const { baseURL, requests } = startMockOpenAI();
		const output = join(dir, "clip.mp4");

		const result = await runCli(
			[
				"video",
				"generate",
				"--prompt",
				"mock tracking shot",
				"--model",
				"sora-2",
				"--size",
				"1280x720",
				"--seconds",
				"4",
				"--out",
				output,
				"--poll-interval",
				"0",
				"--timeout",
				"1",
				"--output",
				"json",
			],
			testEnv(home, baseURL),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(existsSync(output)).toBe(true);
		expect(readFileSync(output, "utf-8")).toBe("mock-video");
		expect(existsSync(`${output}.json`)).toBe(true);

		const cliJson = JSON.parse(result.stdout);
		expect(cliJson.kind).toBe("video.generate");
		expect(cliJson.outputs).toEqual([output]);
		expect(cliJson.metadata.video.status).toBe("completed");

		const sidecar = JSON.parse(readFileSync(`${output}.json`, "utf-8"));
		expect(sidecar.params.model).toBe("sora-2");
		expect(sidecar.params.prompt).toBe("mock tracking shot");

		expect(requests.map((request) => request.path)).toEqual([
			"/v1/videos",
			"/v1/videos/video_mock",
			"/v1/videos/video_mock/content",
		]);
		expect(requests[0]?.body).toContain("mock tracking shot");
	});

	test("creates video jobs with image references and character ids", async () => {
		const home = mkdtempSync(join(tmpdir(), "ploof-openai-home-"));
		const { baseURL, requests } = startMockOpenAI();

		const result = await runCli(
			[
				"video",
				"generate",
				"--prompt",
				"mock character shot",
				"--input-reference",
				"file_mock",
				"--character",
				"char_mock",
				"--output",
				"json",
			],
			testEnv(home, baseURL),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		const cliJson = JSON.parse(result.stdout);
		expect(cliJson.kind).toBe("video.generate");
		expect(cliJson.outputs).toEqual([]);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.path).toBe("/v1/videos");
		expect(requests[0]?.body).toContain("file_mock");
		expect(requests[0]?.body).toContain("char_mock");
	});

	test("downloads video supporting assets", async () => {
		const home = mkdtempSync(join(tmpdir(), "ploof-openai-home-"));
		const dir = mkdtempSync(join(tmpdir(), "ploof-openai-video-download-"));
		const { baseURL, requests } = startMockOpenAI();
		const output = join(dir, "asset.webp");

		const result = await runCli(
			[
				"video",
				"download",
				"video_mock",
				"--variant",
				"thumbnail",
				"--out",
				output,
				"--output",
				"json",
			],
			testEnv(home, baseURL),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(readFileSync(output, "utf-8")).toBe("mock-thumbnail");

		const cliJson = JSON.parse(result.stdout);
		expect(cliJson.kind).toBe("video.download");
		expect(cliJson.outputs).toEqual([output]);
		expect(requests[0]?.path).toBe("/v1/videos/video_mock/content");
		expect(requests[0]?.search).toBe("?variant=thumbnail");
	});

	test("edits, extends, remixes, lists, deletes, and manages characters", async () => {
		const home = mkdtempSync(join(tmpdir(), "ploof-openai-home-"));
		const dir = mkdtempSync(join(tmpdir(), "ploof-openai-video-suite-"));
		const { baseURL, requests } = startMockOpenAI();
		const sourceVideo = join(dir, "source.mp4");
		writeFileSync(sourceVideo, "mock source video");

		const env = testEnv(home, baseURL);
		const commands = [
			["video", "edit", "--video-id", "video_mock", "--prompt", "make it teal"],
			[
				"video",
				"extend",
				"--video-id",
				"video_mock",
				"--prompt",
				"continue upward",
				"--seconds",
				"4",
			],
			[
				"video",
				"remix",
				"--video-id",
				"video_mock",
				"--prompt",
				"refresh the camera motion",
			],
			["video", "status", "video_mock"],
			["video", "list", "--limit", "1", "--order", "asc"],
			["video", "delete", "video_mock"],
			[
				"video",
				"character",
				"create",
				"--name",
				"Mossy",
				"--video",
				sourceVideo,
			],
			["video", "character", "get", "char_mock"],
		];

		for (const command of commands) {
			const result = await runCli([...command, "--output", "json"], env);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(JSON.parse(result.stdout).provider).toBe("openai");
		}

		expect(requests.map((request) => request.path)).toEqual([
			"/v1/videos/edits",
			"/v1/videos/extensions",
			"/v1/videos/video_mock/remix",
			"/v1/videos/video_mock",
			"/v1/videos",
			"/v1/videos/video_mock",
			"/v1/videos/characters",
			"/v1/videos/characters/char_mock",
		]);
		expect(requests[4]?.search).toContain("limit=1");
		expect(requests[4]?.search).toContain("order=asc");
	});

	test("generates speech audio and writes sidecar metadata", async () => {
		const home = mkdtempSync(join(tmpdir(), "ploof-openai-home-"));
		const dir = mkdtempSync(join(tmpdir(), "ploof-openai-audio-"));
		const { baseURL, requests } = startMockOpenAI();
		const output = join(dir, "speech.mp3");

		const result = await runCli(
			[
				"audio",
				"generate",
				"--text",
				"hello from ploof",
				"--model",
				"gpt-4o-mini-tts",
				"--voice",
				"alloy",
				"--format",
				"mp3",
				"--out",
				output,
				"--output",
				"json",
			],
			testEnv(home, baseURL),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(readFileSync(output, "utf-8")).toBe("mock-mp3-audio");
		expect(existsSync(`${output}.json`)).toBe(true);

		const cliJson = JSON.parse(result.stdout);
		expect(cliJson.kind).toBe("audio.generate");
		expect(cliJson.outputs).toEqual([output]);
		expect(cliJson.metadata.model).toBe("gpt-4o-mini-tts");
		expect(cliJson.metadata.voice).toBe("alloy");

		const sidecar = JSON.parse(readFileSync(`${output}.json`, "utf-8"));
		expect(sidecar.params.input).toBe("hello from ploof");
		expect(sidecar.params.response_format).toBe("mp3");
		expect(requests[0]?.path).toBe("/v1/audio/speech");
		expect(requests[0]?.body).toContain("hello from ploof");
	});

	test("rejects streaming audio transport for static asset outputs", async () => {
		const home = mkdtempSync(join(tmpdir(), "ploof-openai-home-"));
		const dir = mkdtempSync(join(tmpdir(), "ploof-openai-audio-static-"));
		const { baseURL, requests } = startMockOpenAI();

		const speech = await runCli(
			[
				"audio",
				"generate",
				"--text",
				"hello from ploof",
				"--param",
				"stream_format=sse",
				"--out",
				join(dir, "speech.mp3"),
			],
			testEnv(home, baseURL),
		);

		expect(speech.exitCode).toBe(1);
		expect(speech.stderr).toContain("complete static audio files");

		const audio = join(dir, "speech.mp3");
		writeFileSync(audio, "mock source audio");
		const transcript = await runCli(
			[
				"audio",
				"transcribe",
				"--audio",
				audio,
				"--param",
				"stream=true",
				"--out",
				join(dir, "transcript.json"),
			],
			testEnv(home, baseURL),
		);

		expect(transcript.exitCode).toBe(1);
		expect(transcript.stderr).toContain("complete static transcript assets");
		expect(requests).toHaveLength(0);
	});

	test("transcribes and translates audio files", async () => {
		const home = mkdtempSync(join(tmpdir(), "ploof-openai-home-"));
		const dir = mkdtempSync(join(tmpdir(), "ploof-openai-audio-process-"));
		const { baseURL, requests } = startMockOpenAI();
		const audio = join(dir, "speech.mp3");
		const transcript = join(dir, "transcript.json");
		const translation = join(dir, "translation.txt");
		writeFileSync(audio, "mock source audio");

		const transcribe = await runCli(
			[
				"audio",
				"transcribe",
				"--audio",
				audio,
				"--model",
				"gpt-4o-mini-transcribe",
				"--out",
				transcript,
				"--output",
				"json",
			],
			testEnv(home, baseURL),
		);

		expect(transcribe.exitCode).toBe(0);
		expect(transcribe.stderr).toBe("");
		expect(readFileSync(transcript, "utf-8")).toContain("mock transcript text");
		expect(existsSync(`${transcript}.json`)).toBe(true);
		const transcribeJson = JSON.parse(transcribe.stdout);
		expect(transcribeJson.kind).toBe("audio.transcribe");
		expect(transcribeJson.metadata.text).toBe("mock transcript text");

		const translate = await runCli(
			[
				"audio",
				"translate",
				"--audio",
				audio,
				"--model",
				"whisper-1",
				"--format",
				"text",
				"--out",
				translation,
				"--output",
				"json",
			],
			testEnv(home, baseURL),
		);

		expect(translate.exitCode).toBe(0);
		expect(translate.stderr).toBe("");
		expect(readFileSync(translation, "utf-8")).toBe("mock translated text");
		expect(existsSync(`${translation}.json`)).toBe(true);
		const translateJson = JSON.parse(translate.stdout);
		expect(translateJson.kind).toBe("audio.translate");
		expect(translateJson.metadata.text).toBe("mock translated text");

		expect(requests.map((request) => request.path)).toEqual([
			"/v1/audio/transcriptions",
			"/v1/audio/translations",
		]);
		expect(requests[0]?.contentType).toContain("multipart/form-data");
		expect(requests[1]?.contentType).toContain("multipart/form-data");
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
		expect(cliJson.map((item: { id: string }) => item.id).sort()).toEqual([
			"base",
			"edit",
			"variation",
		]);
		expect(requests[0]?.path).toBe("/v1/images/generations");
		expect(
			requests
				.slice(1)
				.map((request) => request.path)
				.sort(),
		).toEqual(["/v1/images/edits", "/v1/images/variations"]);
	});

	test("runs video generation tasks from manifests", async () => {
		const home = mkdtempSync(join(tmpdir(), "ploof-openai-home-"));
		const dir = mkdtempSync(join(tmpdir(), "ploof-openai-video-manifest-"));
		const { baseURL, requests } = startMockOpenAI();
		const manifest = join(dir, "videos.yaml");
		const clip = join(dir, "assets/clip.mp4");
		writeFileSync(
			manifest,
			[
				"version: 1",
				"parallel: 1",
				"tasks:",
				"  - id: clip",
				"    kind: video.generate",
				"    provider: openai",
				"    prompt: mock video manifest",
				"    params:",
				"      model: sora-2",
				"      size: 1280x720",
				"      seconds: '4'",
				"    wait: true",
				"    download: true",
				"    pollIntervalMs: 0",
				"    timeoutMs: 1000",
				"    output: assets/clip.mp4",
			].join("\n"),
		);

		const result = await runCli(
			["run", manifest, "--parallel", "1", "--output", "json"],
			testEnv(home, baseURL),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(readFileSync(clip, "utf-8")).toBe("mock-video");
		expect(existsSync(`${clip}.json`)).toBe(true);

		const cliJson = JSON.parse(result.stdout);
		expect(cliJson[0].kind).toBe("video.generate");
		expect(cliJson[0].outputs).toEqual([clip]);
		expect(requests.map((request) => request.path)).toEqual([
			"/v1/videos",
			"/v1/videos/video_mock",
			"/v1/videos/video_mock/content",
		]);
	});

	test("runs audio generation and transcription tasks from manifests", async () => {
		const home = mkdtempSync(join(tmpdir(), "ploof-openai-home-"));
		const dir = mkdtempSync(join(tmpdir(), "ploof-openai-audio-manifest-"));
		const { baseURL, requests } = startMockOpenAI();
		const manifest = join(dir, "audio.yaml");
		const speech = join(dir, "assets/speech.mp3");
		const transcript = join(dir, "assets/transcript.json");
		writeFileSync(
			manifest,
			[
				"version: 1",
				"parallel: 2",
				"tasks:",
				"  - id: speech",
				"    kind: audio.generate",
				"    provider: openai",
				"    text: hello from manifest",
				"    params:",
				"      model: gpt-4o-mini-tts",
				"      voice: alloy",
				"      response_format: mp3",
				"    output: assets/speech.mp3",
				"  - id: transcript",
				"    kind: audio.transcribe",
				"    provider: openai",
				"    needs: [speech]",
				"    inputs:",
				"      audio:",
				"        task: speech",
				"    params:",
				"      model: gpt-4o-mini-transcribe",
				"    output: assets/transcript.json",
			].join("\n"),
		);

		const result = await runCli(
			["run", manifest, "--parallel", "2", "--output", "json"],
			testEnv(home, baseURL),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(readFileSync(speech, "utf-8")).toBe("mock-mp3-audio");
		expect(readFileSync(transcript, "utf-8")).toContain("mock transcript text");
		expect(existsSync(`${speech}.json`)).toBe(true);
		expect(existsSync(`${transcript}.json`)).toBe(true);

		const cliJson = JSON.parse(result.stdout);
		expect(cliJson.map((item: { id: string }) => item.id)).toEqual([
			"speech",
			"transcript",
		]);
		expect(requests.map((request) => request.path)).toEqual([
			"/v1/audio/speech",
			"/v1/audio/transcriptions",
		]);
	});
});
