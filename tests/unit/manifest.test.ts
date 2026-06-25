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
			].join("\n"),
		);

		const manifest = await parseManifest(manifestPath);
		expect(manifest.tasks.map((task) => task.id)).toEqual(["base", "edit"]);

		const results = await runManifest(manifestPath, { dryRun: true });
		expect(results).toHaveLength(2);
		expect(results[0]?.metadata).toEqual({ dryRun: true, needs: [] });
		expect(results[1]?.metadata).toEqual({ dryRun: true, needs: ["base"] });
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
});
