import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Config, DEFAULT_CONFIG } from "../../src/config";

describe("Config", () => {
	test("reads, writes, and resets config values", () => {
		const dir = mkdtempSync(join(tmpdir(), "ploof-config-"));
		const config = new Config(dir);

		expect(config.list()).toEqual(DEFAULT_CONFIG);

		config.set("output", "json");
		config.set("defaultParallel", 8);

		const reloaded = new Config(dir);
		expect(reloaded.get("output")).toBe("json");
		expect(reloaded.get("defaultParallel")).toBe(8);

		reloaded.reset();
		expect(new Config(dir).list()).toEqual(DEFAULT_CONFIG);
	});
});
