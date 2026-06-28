import OpenAI from "openai";
import type { ProviderContext } from "../types";

export function createOpenAIClient(context: ProviderContext): OpenAI {
	const credential = context.credential;
	if (!credential.apiKey) {
		throw new Error(
			"No OpenAI API key found. Run 'ploof login openai --api-key <key>' or set PLOOF_OPENAI_API_KEY.",
		);
	}

	return new OpenAI({
		apiKey: credential.apiKey,
		organization: credential.organization,
		project: credential.project,
		baseURL: credential.baseURL,
	});
}
