import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Auth } from "../../src/auth";

const originalPloofKey = process.env.PLOOF_OPENAI_API_KEY;
const originalOpenAIKey = process.env.OPENAI_API_KEY;
const originalPloofFalKey = process.env.PLOOF_FAL_KEY;
const originalFalKey = process.env.FAL_KEY;
const originalPloofFalKeyId = process.env.PLOOF_FAL_KEY_ID;
const originalPloofFalKeySecret = process.env.PLOOF_FAL_KEY_SECRET;
const originalFalKeyId = process.env.FAL_KEY_ID;
const originalFalKeySecret = process.env.FAL_KEY_SECRET;

afterEach(() => {
	if (originalPloofKey === undefined) delete process.env.PLOOF_OPENAI_API_KEY;
	else process.env.PLOOF_OPENAI_API_KEY = originalPloofKey;

	if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
	else process.env.OPENAI_API_KEY = originalOpenAIKey;

	if (originalPloofFalKey === undefined) delete process.env.PLOOF_FAL_KEY;
	else process.env.PLOOF_FAL_KEY = originalPloofFalKey;

	if (originalFalKey === undefined) delete process.env.FAL_KEY;
	else process.env.FAL_KEY = originalFalKey;

	if (originalPloofFalKeyId === undefined) delete process.env.PLOOF_FAL_KEY_ID;
	else process.env.PLOOF_FAL_KEY_ID = originalPloofFalKeyId;

	if (originalPloofFalKeySecret === undefined) {
		delete process.env.PLOOF_FAL_KEY_SECRET;
	} else {
		process.env.PLOOF_FAL_KEY_SECRET = originalPloofFalKeySecret;
	}

	if (originalFalKeyId === undefined) delete process.env.FAL_KEY_ID;
	else process.env.FAL_KEY_ID = originalFalKeyId;

	if (originalFalKeySecret === undefined) delete process.env.FAL_KEY_SECRET;
	else process.env.FAL_KEY_SECRET = originalFalKeySecret;
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

	test("reads fal credentials from token and split-key environment variables", () => {
		const dir = mkdtempSync(join(tmpdir(), "ploof-auth-fal-env-"));
		const auth = new Auth(dir);
		auth.login("fal", "default", { apiKey: "fal-stored" });

		process.env.FAL_KEY = "fal-env";
		process.env.PLOOF_FAL_KEY = "fal-ploof-env";
		process.env.FAL_KEY_ID = "";
		process.env.FAL_KEY_SECRET = "";
		process.env.PLOOF_FAL_KEY_ID = "";
		process.env.PLOOF_FAL_KEY_SECRET = "";

		expect(auth.getCredential("fal")?.apiKey).toBe("fal-ploof-env");

		process.env.PLOOF_FAL_KEY = "";
		process.env.FAL_KEY = "";
		process.env.PLOOF_FAL_KEY_ID = "fal-id";
		process.env.PLOOF_FAL_KEY_SECRET = "fal-secret";

		expect(auth.getCredential("fal")?.apiKey).toBe("fal-id:fal-secret");
	});
});
