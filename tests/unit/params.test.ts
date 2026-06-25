import { describe, expect, test } from "bun:test";
import {
	mergeObjects,
	parseJsonObject,
	parseParamAssignments,
} from "../../src/params";

describe("params", () => {
	test("parses scalar and nested param assignments", () => {
		expect(
			parseParamAssignments([
				"model=gpt-image-1",
				"n=2",
				"stream=true",
				"metadata.foo=bar",
			]),
		).toEqual({
			model: "gpt-image-1",
			n: 2,
			stream: true,
			metadata: { foo: "bar" },
		});
	});

	test("parses json object overrides", () => {
		expect(parseJsonObject('{"size":"1024x1024"}')).toEqual({
			size: "1024x1024",
		});
	});

	test("merges nested objects", () => {
		expect(mergeObjects({ a: { b: 1 }, c: 1 }, { a: { d: 2 } })).toEqual({
			a: { b: 1, d: 2 },
			c: 1,
		});
	});
});
