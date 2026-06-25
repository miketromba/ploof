import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Auth } from "../../src/auth";

const originalPloofKey = process.env.PLOOF_OPENAI_API_KEY;
const originalOpenAIKey = process.env.OPENAI_API_KEY;

afterEach(() => {
	if (originalPloofKey === undefined) delete process.env.PLOOF_OPENAI_API_KEY;
	else process.env.PLOOF_OPENAI_API_KEY = originalPloofKey;

	if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
	else process.env.OPENAI_API_KEY = originalOpenAIKey;
});

describe("Auth", () => {
	test("stores and removes provider profiles", () => {
		const dir = mkdtempSync(join(tmpdir(), "ploof-auth-"));
		const auth = new Auth(dir);

		auth.login("openai", "default", { apiKey: "sk-test" });
		expect(auth.status("openai").authenticated).toBe(true);
		expect(auth.status("openai").source).toBe("stored");
		expect(auth.listProfiles("openai")).toEqual({ openai: ["default"] });

		expect(auth.logout("openai")).toBe(true);
		expect(auth.status("openai").authenticated).toBe(false);
	});

	test("prefers PLOOF_OPENAI_API_KEY over OPENAI_API_KEY and stored credentials", () => {
		const dir = mkdtempSync(join(tmpdir(), "ploof-auth-env-"));
		const auth = new Auth(dir);
		auth.login("openai", "default", { apiKey: "sk-stored" });

		process.env.OPENAI_API_KEY = "sk-openai-env";
		process.env.PLOOF_OPENAI_API_KEY = "sk-ploof-env";

		const credential = auth.getCredential("openai");
		expect(credential?.apiKey).toBe("sk-ploof-env");
		expect(credential?.source).toBe("env");
	});
});
