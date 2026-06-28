import type { Provider, ProviderId } from "../types";
import { FalProvider } from "./fal";
import { OpenAIProvider } from "./openai";

export const PROVIDERS: Provider[] = [new OpenAIProvider(), new FalProvider()];

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
