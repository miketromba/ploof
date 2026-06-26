import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hasOpenAIKey = Boolean(
	process.env.PLOOF_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
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

describe.skipIf(!hasOpenAIKey)("OpenAI live end-to-end", () => {
	test("generates an image through OpenAI and writes sidecar metadata", async () => {
		const home = mkdtempSync(join(tmpdir(), "ploof-live-home-"));
		const dir = mkdtempSync(join(tmpdir(), "ploof-live-openai-"));
		const output = join(dir, "live.png");
		const env = { PLOOF_HOME: home };

		const result = await runCli(
			[
				"image",
				"generate",
				"--prompt",
				"A simple red cube on a white background",
				"--model",
				process.env.PLOOF_OPENAI_LIVE_MODEL ?? "gpt-image-2",
				"--size",
				process.env.PLOOF_OPENAI_LIVE_SIZE ?? "1024x1024",
				"--format",
				"png",
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
		expect(parsed.kind).toBe("image.generate");
		expect(parsed.outputs).toEqual([output]);
	}, 120_000);
});
