#!/usr/bin/env bun

import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";

const DIST = "dist";

if (!existsSync(DIST)) {
	mkdirSync(DIST, { recursive: true });
}

console.log("Building Node.js bundle...");

const result = await Bun.build({
	entrypoints: ["bin/ploof.ts"],
	outdir: DIST,
	target: "node",
	minify: true,
	naming: "ploof.js",
	external: [],
});

if (!result.success) {
	console.error("Build failed:");
	for (const log of result.logs) {
		console.error(log);
	}
	process.exit(1);
}

const bundlePath = `${DIST}/ploof.js`;
let content = await Bun.file(bundlePath).text();
content = content.replace(/^#!\/usr\/bin\/env bun\n?/gm, "");
writeFileSync(bundlePath, `#!/usr/bin/env node\n${content}`);
chmodSync(bundlePath, 0o755);

const size = ((await Bun.file(bundlePath).size) / 1024).toFixed(0);
console.log(`  dist/ploof.js  ${size} KB`);
console.log("Done.");
