import { describe, expect, test } from "bun:test";
import { getLearnOutput } from "../../src/learn";

describe("learn", () => {
	test("prints agent instructions", () => {
		const output = getLearnOutput();
		expect(output).toContain("# Generate assets with the ploof CLI");
		expect(output).toContain("ploof image generate");
		expect(output).toContain("ploof run assets.yaml");
	});
});
