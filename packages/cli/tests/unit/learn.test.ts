import { describe, expect, test } from "bun:test";
import { getLearnOutput } from "../../src/learn";

describe("learn", () => {
	test("prints agent instructions", () => {
		const output = getLearnOutput();
		expect(output).toContain("# Generate assets with the ploof CLI");
		expect(output).toContain("Package name: `@miketromba/ploof`");
		expect(output).toContain("There is no `ploof auth` namespace");
		expect(output).toContain("ploof image generate");
		expect(output).toContain("ploof image variation");
		expect(output).toContain("Important: `--format png`");
		expect(output).toContain("Parseable result shape");
		expect(output).toContain("ploof run assets.yaml");
		expect(output).toContain("inputs.images");
		expect(output).toContain("Do not claim assets were generated");
	});
});
