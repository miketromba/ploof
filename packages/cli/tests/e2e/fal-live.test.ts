import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hasFalKey = Boolean(
	process.env.PLOOF_FAL_KEY ||
		process.env.FAL_KEY ||
		(process.env.PLOOF_FAL_KEY_ID && process.env.PLOOF_FAL_KEY_SECRET) ||
		(process.env.FAL_KEY_ID && process.env.FAL_KEY_SECRET),
);

async function runCli(args: string[], env: Record<string, string>) {
	const proc = Bun.spawn(["bun", "run", "bin/ploof.ts", ...args], {
		env: {
			...process.env,
			...env,
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

describe.skipIf(!hasFalKey)("fal.ai live end-to-end", () => {
	test("runs a fal model endpoint and writes the returned image", async () => {
		const home = mkdtempSync(join(tmpdir(), "ploof-live-fal-home-"));
		const dir = mkdtempSync(join(tmpdir(), "ploof-live-fal-"));
		const output = join(dir, "fal-live.png");
		const env = { PLOOF_HOME: home };

		const result = await runCli(
			[
				"model",
				"run",
				"--provider",
				"fal",
				"--model",
				process.env.PLOOF_FAL_LIVE_MODEL ?? "fal-ai/flux/schnell",
				"--prompt",
				"A simple friendly CLI mascot icon on a clean background",
				"--param",
				process.env.PLOOF_FAL_LIVE_IMAGE_SIZE_PARAM ?? "image_size=square_hd",
				"--out",
				output,
				"--output",
				"json",
			],
			env,
		);

		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
		expect(existsSync(output)).toBe(true);
		expect(existsSync(`${output}.json`)).toBe(true);

		const parsed = JSON.parse(result.stdout);
		expect(parsed.kind).toBe("model.run");
		expect(parsed.provider).toBe("fal");
		expect(parsed.outputs).toEqual([output]);
	}, 180_000);
});
