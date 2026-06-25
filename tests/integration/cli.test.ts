import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function runCli(args: string[], env: Record<string, string> = {}) {
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

describe("ploof CLI", () => {
	test("prints help", async () => {
		const result = await runCli(["--help"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("AI asset generation CLI");
	});

	test("auth login, status, and logout lifecycle", async () => {
		const home = mkdtempSync(join(tmpdir(), "ploof-cli-"));
		const env = { PLOOF_HOME: home };

		const login = await runCli(
			["auth", "login", "openai", "--api-key", "sk-test", "--profile", "test"],
			env,
		);
		expect(login.exitCode).toBe(0);
		expect(login.stdout).toContain("Authenticated openai profile=test");

		const status = await runCli(
			["auth", "status", "openai", "--profile", "test"],
			env,
		);
		expect(status.exitCode).toBe(0);
		expect(status.stdout).toContain("provider=openai");
		expect(status.stdout).toContain("profile=test");

		const logout = await runCli(
			["auth", "logout", "openai", "--profile", "test"],
			env,
		);
		expect(logout.exitCode).toBe(0);
		expect(logout.stdout).toContain("Logged out openai profile=test");
	});

	test("learn command prints guidance", async () => {
		const result = await runCli(["learn"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("ploof image edit");
	});
});
