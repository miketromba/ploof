#!/usr/bin/env bun

import { createProgram } from "../src/cli";

const program = createProgram();

program.parseAsync(process.argv).catch((err) => {
	process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
	process.exit(1);
});
