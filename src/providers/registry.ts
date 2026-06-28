import type { Provider, ProviderId } from "../types";
import { OpenAIProvider } from "./openai";

export const PROVIDERS: Provider[] = [new OpenAIProvider()];

export function findProvider(id: ProviderId): Provider | undefined {
	return PROVIDERS.find((candidate) => candidate.id === id);
}

export function getProvider(id: ProviderId): Provider {
	const provider = findProvider(id);
	if (!provider) {
		throw new Error(`Unknown provider: ${id}`);
	}
	return provider;
}
