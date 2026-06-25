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
		expect(result.stdout).toContain("ploof login openai");
		expect(result.stdout).not.toContain("  auth");
	});

	test("top-level login, whoami, and logout lifecycle", async () => {
		const home = mkdtempSync(join(tmpdir(), "ploof-cli-login-"));
		const env = { PLOOF_HOME: home };

		const login = await runCli(
			["login", "openai", "--api-key", "sk-test", "--profile", "test"],
			env,
		);
		expect(login.exitCode).toBe(0);
		expect(login.stdout).toContain("Authenticated openai profile=test");

		const status = await runCli(["whoami", "openai", "--profile", "test"], env);
		expect(status.exitCode).toBe(0);
		expect(status.stdout).toContain("provider=openai");
		expect(status.stdout).toContain("profile=test");

		const profiles = await runCli(["profiles", "openai"], env);
		expect(profiles.exitCode).toBe(0);
		expect(profiles.stdout).toContain("openai: test");

		const logout = await runCli(["logout", "openai", "--profile", "test"], env);
		expect(logout.exitCode).toBe(0);
		expect(logout.stdout).toContain("Logged out openai profile=test");
	});

	test("login requires an api key in non-interactive mode", async () => {
		const home = mkdtempSync(join(tmpdir(), "ploof-cli-login-missing-"));
		const result = await runCli(["login", "openai"], {
			OPENAI_API_KEY: "",
			PLOOF_HOME: home,
			PLOOF_OPENAI_API_KEY: "",
		});
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("API key is required");
	});

	test("login can store an exported api key", async () => {
		const home = mkdtempSync(join(tmpdir(), "ploof-cli-login-env-"));
		const login = await runCli(["login", "openai", "--profile", "env"], {
			PLOOF_HOME: home,
			PLOOF_OPENAI_API_KEY: "sk-env",
		});
		expect(login.exitCode).toBe(0);
		expect(login.stdout).toContain("Authenticated openai profile=env");

		const status = await runCli(["whoami", "openai", "--profile", "env"], {
			OPENAI_API_KEY: "",
			PLOOF_HOME: home,
			PLOOF_OPENAI_API_KEY: "",
		});
		expect(status.exitCode).toBe(0);
		expect(status.stdout).toContain("source=stored");
	});

	test("learn command prints guidance", async () => {
		const result = await runCli(["learn"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("ploof image edit");
	});
});
