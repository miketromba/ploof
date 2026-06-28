import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest, runManifest } from "../../src/manifest";

describe("manifest", () => {
	test("parses and dry-runs dependency manifests", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ploof-manifest-"));
		const manifestPath = join(dir, "assets.yaml");
		writeFileSync(
			manifestPath,
			[
				"version: 1",
				"parallel: 2",
				"tasks:",
				"  - id: base",
				"    kind: image.generate",
				"    provider: openai",
				'    prompt: "base"',
				"    output: assets/base.png",
				"  - id: edit",
				"    kind: image.edit",
				"    provider: openai",
				"    needs: [base]",
				'    prompt: "edit"',
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

		const manifest = await parseManifest(manifestPath);
		expect(manifest.tasks.map((task) => task.id)).toEqual([
			"base",
			"edit",
			"variation",
		]);

		const results = await runManifest(manifestPath, { dryRun: true });
		expect(results).toHaveLength(3);
		expect(results[0]?.metadata).toEqual({ dryRun: true, needs: [] });
		expect(results[1]?.metadata).toEqual({ dryRun: true, needs: ["base"] });
		expect(results[2]?.metadata).toEqual({ dryRun: true, needs: ["base"] });
	});

	test("rejects unknown dependencies", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ploof-manifest-bad-"));
		const manifestPath = join(dir, "assets.yaml");
		writeFileSync(
			manifestPath,
			[
				"version: 1",
				"tasks:",
				"  - id: edit",
				"    kind: image.generate",
				"    needs: [missing]",
				'    prompt: "edit"',
			].join("\n"),
		);

		await expect(parseManifest(manifestPath)).rejects.toThrow(
			"depends on unknown task",
		);
	});

	test("accepts generic input role maps", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ploof-manifest-inputs-"));
		const manifestPath = join(dir, "assets.yaml");
		writeFileSync(
			manifestPath,
			[
				"version: 1",
				"tasks:",
				"  - id: base",
				"    kind: image.generate",
				'    prompt: "base"',
				"    output: base.png",
				"  - id: edit",
				"    kind: image.edit",
				"    needs: [base]",
				'    prompt: "edit"',
				"    inputs:",
				"      image:",
				"        task: base",
				"      style:",
				"        source: style.png",
				"    output: edit.png",
			].join("\n"),
		);

		const manifest = await parseManifest(manifestPath);
		expect(manifest.tasks[1]?.inputs?.image).toEqual({ task: "base" });
		expect(manifest.tasks[1]?.inputs?.style).toEqual({ source: "style.png" });
	});

	test("accepts provider-neutral model run tasks", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ploof-manifest-model-run-"));
		const manifestPath = join(dir, "assets.yaml");
		writeFileSync(
			manifestPath,
			[
				"version: 1",
				"tasks:",
				"  - id: fal-image",
				"    kind: model.run",
				"    model: fal-ai/flux/dev",
				'    prompt: "small app icon"',
				"    params:",
				"      image_size: square_hd",
				"    output: icon.png",
				"  - id: fal-video",
				"    kind: model.run",
				"    provider: fal",
				"    model: fal-ai/example/video",
				"    needs: [fal-image]",
				"    inputs:",
				"      image_url:",
				"        task: fal-image",
				"    output: clip.mp4",
			].join("\n"),
		);

		const manifest = await parseManifest(manifestPath);
		expect(manifest.tasks[0]?.kind).toBe("model.run");
		expect(manifest.tasks[0]?.model).toBe("fal-ai/flux/dev");
		expect(manifest.tasks[1]?.inputs?.image_url).toEqual({ task: "fal-image" });

		const results = await runManifest(manifestPath, { dryRun: true });
		expect(results).toHaveLength(2);
		expect(results[0]?.provider).toBe("fal");
	});
});
