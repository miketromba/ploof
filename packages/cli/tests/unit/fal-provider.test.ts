import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FalClientLike, FalProvider } from "../../src/providers/fal";

const TINY_PNG_DATA_URL =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

describe("FalProvider", () => {
	test("runs image generation through a fal endpoint and persists returned assets", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ploof-fal-image-"));
		const output = join(dir, "image.png");
		let subscribeCall:
			| {
					endpointId: string;
					options: Parameters<FalClientLike["subscribe"]>[1];
			  }
			| undefined;
		const client: FalClientLike = {
			storage: {
				upload: async () => {
					throw new Error("image generation should not upload inputs");
				},
			},
			subscribe: async (endpointId, options) => {
				subscribeCall = { endpointId, options };
				return {
					requestId: "req_fal_image",
					data: {
						images: [
							{
								url: TINY_PNG_DATA_URL,
								content_type: "image/png",
							},
						],
					},
				};
			},
		};

		const provider = new FalProvider(() => client);
		const result = await provider.run(
			{
				kind: "image.generate",
				provider: "fal",
				prompt: "tiny transparent icon",
				output,
				params: {
					model: "fal-ai/flux/dev",
					seed: 123,
					storage_expires_in: "1d",
				},
			},
			{
				credential: {
					apiKey: "fal-key",
					profile: "test",
				},
				sidecar: false,
			},
		);

		expect(subscribeCall?.endpointId).toBe("fal-ai/flux/dev");
		expect(subscribeCall?.options.mode).toBe("polling");
		expect(subscribeCall?.options.input).toEqual({
			seed: 123,
			prompt: "tiny transparent icon",
		});
		expect(subscribeCall?.options.storageSettings).toEqual({ expiresIn: "1d" });
		expect(result.outputs).toEqual([output]);
		expect(readFileSync(output).byteLength).toBeGreaterThan(0);
	});

	test("uploads local model inputs under exact field names", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ploof-fal-model-"));
		const input = join(dir, "input.png");
		const output = join(dir, "clip.mp4");
		writeFileSync(input, "mock image bytes");

		let uploadType: string | undefined;
		let uploadOptions: Parameters<FalClientLike["storage"]["upload"]>[1];
		let subscribeCall:
			| {
					endpointId: string;
					options: Parameters<FalClientLike["subscribe"]>[1];
			  }
			| undefined;
		const client: FalClientLike = {
			storage: {
				upload: async (file, options) => {
					uploadType = file.type;
					uploadOptions = options;
					return "https://fal.media/uploads/source.png";
				},
			},
			subscribe: async (endpointId, options) => {
				subscribeCall = { endpointId, options };
				return {
					requestId: "req_fal_model",
					data: {
						video: {
							url: "data:video/mp4;base64,bW9jay12aWRlbw==",
							content_type: "video/mp4",
						},
					},
				};
			},
		};

		const provider = new FalProvider(() => client);
		const result = await provider.run(
			{
				kind: "model.run",
				provider: "fal",
				model: "fal-ai/example/video",
				prompt: "animate this",
				output,
				inputs: [{ role: "image_url", source: input }],
				params: {
					prompt: "animate this",
					timeout_ms: 5000,
					poll_interval_ms: 250,
					priority: "low",
					storage_expires_in: "1h",
				},
			},
			{
				credential: {
					apiKey: "fal-key",
					profile: "test",
				},
				sidecar: false,
			},
		);

		expect(uploadType).toBe("image/png");
		expect(uploadOptions).toEqual({ lifecycle: { expiresIn: "1h" } });
		expect(subscribeCall?.endpointId).toBe("fal-ai/example/video");
		expect(subscribeCall?.options.input).toEqual({
			prompt: "animate this",
			image_url: "https://fal.media/uploads/source.png",
		});
		expect(subscribeCall?.options.timeout).toBe(5000);
		expect(subscribeCall?.options.pollInterval).toBe(250);
		expect(subscribeCall?.options.priority).toBe("low");
		expect(result.outputs).toEqual([output]);
		expect(readFileSync(output, "utf-8")).toBe("mock-video");
	});

	test("persists text outputs for audio processing models", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ploof-fal-audio-"));
		const audio = join(dir, "speech.mp3");
		const output = join(dir, "transcript.txt");
		writeFileSync(audio, "mock audio bytes");

		const client: FalClientLike = {
			storage: {
				upload: async () => "https://fal.media/uploads/speech.mp3",
			},
			subscribe: async () => ({
				requestId: "req_fal_audio",
				data: {
					text: "hello from fal",
				},
			}),
		};

		const provider = new FalProvider(() => client);
		const result = await provider.run(
			{
				kind: "audio.transcribe",
				provider: "fal",
				output,
				inputs: [{ role: "audio", source: audio }],
				params: {
					model: "fal-ai/example/transcribe",
				},
			},
			{
				credential: {
					apiKey: "fal-key",
					profile: "test",
				},
				sidecar: false,
			},
		);

		expect(result.outputs).toEqual([output]);
		expect(readFileSync(output, "utf-8")).toBe("hello from fal");
	});

	test("adds endpoint context to provider errors", async () => {
		const client: FalClientLike = {
			storage: {
				upload: async () => "https://fal.media/uploads/source.png",
			},
			subscribe: async () => {
				const error = new Error("Forbidden") as Error & { status: number };
				error.status = 403;
				throw error;
			},
		};

		const provider = new FalProvider(() => client);
		await expect(
			provider.run(
				{
					kind: "model.run",
					provider: "fal",
					model: "fal-ai/flux/schnell",
					inputs: [],
				},
				{
					credential: {
						apiKey: "fal-key",
						profile: "test",
					},
					sidecar: false,
				},
			),
		).rejects.toThrow(
			"fal.ai model.run failed for fal-ai/flux/schnell: Forbidden. Check the fal.ai API key, account credits, and endpoint access.",
		);
	});
});
