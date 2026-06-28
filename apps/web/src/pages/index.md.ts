import type { APIRoute } from "astro";
import { AGENT_PROMPT } from "../consts";
import homeMd from "../markdown/home.md?raw";

// Raw-Markdown variant of the home page.
export const GET: APIRoute = () =>
	new Response(homeMd.replace("{{AGENT_PROMPT}}", AGENT_PROMPT), {
		headers: { "Content-Type": "text/markdown; charset=utf-8" },
	});
