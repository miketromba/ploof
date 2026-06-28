import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
	site: "https://ploof.sh",
	trailingSlash: "never",
	devToolbar: { enabled: false },
	integrations: [
		sitemap({
			// The OG-card route is a render source for the social image, not a page.
			filter: (page) => !page.includes("/og-card"),
		}),
	],
	vite: {
		plugins: [tailwindcss()],
	},
});
