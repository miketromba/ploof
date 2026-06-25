import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { getPloofDir } from "./paths";
import type { ProviderCredential } from "./types";

const profileSchema = z.object({
	apiKey: z.string().optional(),
	organization: z.string().optional(),
	project: z.string().optional(),
	baseURL: z.string().optional(),
});

const credentialsSchema = z.object({
	providers: z
		.record(
			z.string(),
			z.object({
				defaultProfile: z.string().default("default"),
				profiles: z.record(z.string(), profileSchema).default({}),
			}),
		)
		.default({}),
});

type CredentialsFile = z.infer<typeof credentialsSchema>;
export type AuthProfile = z.infer<typeof profileSchema>;

export interface AuthStatus {
	provider: string;
	profile: string;
	authenticated: boolean;
	source?: "env" | "stored";
	keyPrefix?: string;
	organization?: string;
	project?: string;
	baseURL?: string;
}

export class Auth {
	private readonly credPath: string;

	constructor(baseDir?: string) {
		this.credPath = join(getPloofDir(baseDir), "credentials.json");
	}

	login(
		provider: string,
		profile: string,
		values: AuthProfile,
		makeDefault = true,
	): void {
		if (!values.apiKey) {
			throw new Error("API key is required.");
		}

		const data = this.read();
		const existing = data.providers[provider] ?? {
			defaultProfile: profile,
			profiles: {},
		};
		existing.profiles[profile] = values;
		if (makeDefault) existing.defaultProfile = profile;
		data.providers[provider] = existing;
		this.write(data);
	}

	logout(provider: string, profile?: string): boolean {
		const data = this.read();
		const providerData = data.providers[provider];
		if (!providerData) return false;

		const targetProfile = profile ?? providerData.defaultProfile;
		if (!providerData.profiles[targetProfile]) return false;

		delete providerData.profiles[targetProfile];
		const remaining = Object.keys(providerData.profiles);
		if (remaining.length === 0) {
			delete data.providers[provider];
		} else if (providerData.defaultProfile === targetProfile) {
			providerData.defaultProfile = remaining[0]!;
		}
		this.write(data);
		return true;
	}

	listProfiles(provider?: string): Record<string, string[]> {
		const data = this.read();
		const result: Record<string, string[]> = {};
		for (const [providerId, providerData] of Object.entries(data.providers)) {
			if (provider && providerId !== provider) continue;
			result[providerId] = Object.keys(providerData.profiles);
		}
		return result;
	}

	getDefaultProfile(provider: string): string {
		const data = this.read();
		return data.providers[provider]?.defaultProfile ?? "default";
	}

	getCredential(provider: string, profile?: string): ProviderCredential | null {
		if (provider === "openai") {
			const envKey =
				process.env.PLOOF_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
			if (envKey) {
				return {
					apiKey: envKey,
					organization: process.env.PLOOF_OPENAI_ORG,
					project: process.env.PLOOF_OPENAI_PROJECT,
					baseURL: process.env.PLOOF_OPENAI_BASE_URL,
					source: "env",
					profile: profile ?? "env",
				};
			}
		}

		const data = this.read();
		const providerData = data.providers[provider];
		if (!providerData) return null;
		const targetProfile = profile ?? providerData.defaultProfile;
		const stored = providerData.profiles[targetProfile];
		if (!stored?.apiKey) return null;
		return {
			...stored,
			source: "stored",
			profile: targetProfile,
		};
	}

	status(provider: string, profile?: string): AuthStatus {
		const targetProfile = profile ?? this.getDefaultProfile(provider);
		const credential = this.getCredential(provider, profile);
		if (!credential?.apiKey) {
			return {
				provider,
				profile: targetProfile,
				authenticated: false,
			};
		}

		return {
			provider,
			profile: credential.profile ?? targetProfile,
			authenticated: true,
			source: credential.source,
			keyPrefix: maskKey(credential.apiKey),
			organization: credential.organization,
			project: credential.project,
			baseURL: credential.baseURL,
		};
	}

	private read(): CredentialsFile {
		try {
			if (!existsSync(this.credPath)) {
				return { providers: {} };
			}
			const raw = readFileSync(this.credPath, "utf-8");
			return credentialsSchema.parse(JSON.parse(raw));
		} catch {
			return { providers: {} };
		}
	}

	private write(data: CredentialsFile): void {
		mkdirSync(dirname(this.credPath), { recursive: true });
		writeFileSync(this.credPath, `${JSON.stringify(data, null, 2)}\n`, {
			mode: 0o600,
		});
		try {
			chmodSync(this.credPath, 0o600);
		} catch {
			// Best effort for platforms that do not support chmod.
		}
	}
}

export function maskKey(key: string): string {
	if (key.length <= 12) return `${key.slice(0, 4)}...`;
	return `${key.slice(0, 8)}...${key.slice(-4)}`;
}
