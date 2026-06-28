import type { APIRoute } from "astro";
import { LINKS, SITE } from "../consts";

// https://llmstxt.org — a concise, structured map of the site for LLMs.
const body = `# Ploof

> ${SITE.description}

Ploof is published to npm as \`${LINKS.package}\` (command \`ploof\`). The canonical, always-current agent reference is the \`ploof learn\` command, which prints full instructions for the exact installed version. Every page on this site has a Markdown variant (append \`.md\`, or for the home page use \`/index.md\`).

## Docs
- [Documentation](${SITE.url}/docs.md): Full CLI reference — install, authentication, images, video, audio, model run, batch manifests, output, and configuration.
- [Overview](${SITE.url}/index.md): What Ploof is, the agent setup prompt, and a quickstart.

## Reference
- [npm package](${LINKS.npm}): Install \`${LINKS.package}\`.
- [GitHub repository](${LINKS.github}): Source, issues, and releases.
- [Full README](${LINKS.github}/blob/main/packages/cli/README.md): The complete CLI README.

## Optional
- [llms-full.txt](${SITE.url}/llms-full.txt): All documentation concatenated into a single file.
`;

export const GET: APIRoute = () =>
	new Response(body, {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
