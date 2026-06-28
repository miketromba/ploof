export const SITE = {
	name: "Ploof",
	domain: "ploof.sh",
	url: "https://ploof.sh",
	title: "Ploof — Generate images, video & audio from your terminal",
	tagline: "The agent-native CLI for AI asset generation",
	description:
		"The agent-native CLI for AI asset generation. Generate and edit images, video, and audio from your terminal — OpenAI and fal.ai, driven by your coding agent.",
	author: "Michael Tromba",
} as const;

export const LINKS = {
	npm: "https://www.npmjs.com/package/@miketromba/ploof",
	github: "https://github.com/miketromba/ploof",
	issues: "https://github.com/miketromba/ploof/issues",
	package: "@miketromba/ploof",
	bin: "ploof",
} as const;

export const INSTALL = {
	bun: "bun i -g @miketromba/ploof",
	npm: "npm i -g @miketromba/ploof",
} as const;

/**
 * The hero's primary call to action: a prompt the developer pastes straight
 * into their coding agent. This is the main path to getting value from Ploof.
 */
export const AGENT_PROMPT = `Set up the ploof CLI and generate assets for me:
1. Install: \`bun i -g @miketromba/ploof\`
2. Run \`ploof learn\` and follow it.
3. Make sure I'm logged in (\`ploof whoami\`); if not, help me.

Then ask what I'd like to create — images, video, audio, logos, edits — suggest a few ideas, and make it.`;

export const NAV = [
	{ label: "Gallery", href: "/#gallery" },
	{ label: "Features", href: "/#features" },
	{ label: "Quickstart", href: "/#quickstart" },
	{ label: "Docs", href: "/docs" },
] as const;
