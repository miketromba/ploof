import type { APIRoute } from "astro";
import { AGENT_PROMPT } from "../consts";
import docsMd from "../markdown/docs.md?raw";

// Raw-Markdown variant of /docs — for LLMs, agents, and copy-paste.
export const GET: APIRoute = () =>
	new Response(docsMd.replace("{{AGENT_PROMPT}}", AGENT_PROMPT), {
		headers: { "Content-Type": "text/markdown; charset=utf-8" },
	});
