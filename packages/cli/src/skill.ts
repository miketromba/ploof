import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getPloofDir } from "./paths";

export const SKILL_CONTENT = `---
name: asset-generation
description: Generate, edit, process, or batch-create AI assets with the ploof CLI. Use when working with generated images, videos, audio, arbitrary provider model endpoints, provider auth, asset manifests, image/video/audio context inputs, masks, OpenAI media jobs, fal.ai models, or agent-driven creative asset workflows.
---

# Learn ploof from the CLI

When this skill is relevant, run:

\`\`\`bash
ploof learn
\`\`\`

Follow the instructions printed by \`ploof learn\`. That output is the canonical agent reference for the installed ploof version.

If \`ploof learn\` is unavailable because the CLI is not installed, ask the user to install \`@miketromba/ploof\` first, then rerun \`ploof learn\`.

Do not rely on this skill file for operational details. It is only a bootstrap adapter that points agents to \`ploof learn\`.
`;

export function installSkill(targetDir?: string): string {
	const base = targetDir ?? join(getPloofDir(), "skills", "asset-generation");
	const path = join(base, "SKILL.md");
	if (!existsSync(dirname(path))) {
		mkdirSync(dirname(path), { recursive: true });
	}
	writeFileSync(path, SKILL_CONTENT);
	return path;
}
