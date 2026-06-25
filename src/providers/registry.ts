import type { Provider, ProviderId } from "../types";
import { OpenAIProvider } from "./openai";

export const PROVIDERS: Provider[] = [new OpenAIProvider()];

export function getProvider(id: ProviderId): Provider {
	const provider = PROVIDERS.find((candidate) => candidate.id === id);
	if (!provider) {
		throw new Error(`Unknown provider: ${id}`);
	}
	return provider;
}
