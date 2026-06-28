import type { APIRoute } from "astro";
import { AGENT_PROMPT, LINKS, SITE } from "../consts";
import docsMd from "../markdown/docs.md?raw";

// The complete documentation in one file, for LLM ingestion.
const body = `# ${SITE.name} — full documentation

> ${SITE.description}

Source: ${SITE.url} · Package: ${LINKS.package}

---

${docsMd.replace("{{AGENT_PROMPT}}", AGENT_PROMPT)}
`;

export const GET: APIRoute = () =>
	new Response(body, {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
