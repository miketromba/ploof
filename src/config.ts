import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { getPloofDir } from "./paths";

const configSchema = z.object({
	output: z.enum(["auto", "table", "compact", "json", "jsonl"]).default("auto"),
	defaultParallel: z.number().int().positive().default(4),
	sidecar: z.boolean().default(true),
	noColor: z.boolean().default(false),
});

export type ConfigValues = z.infer<typeof configSchema>;

export const DEFAULT_CONFIG: ConfigValues = {
	output: "auto",
	defaultParallel: 4,
	sidecar: true,
	noColor: false,
};

const VALID_KEYS = new Set<keyof ConfigValues>([
	"output",
	"defaultParallel",
	"sidecar",
	"noColor",
]);

export class Config {
	private readonly configPath: string;
	private values: ConfigValues;

	constructor(baseDir?: string) {
		this.configPath = join(getPloofDir(baseDir), "config.json");
		this.values = { ...DEFAULT_CONFIG };
		this.loadSync();
	}

	private loadSync(): void {
		try {
			if (!existsSync(this.configPath)) return;
			const raw = readFileSync(this.configPath, "utf-8");
			const parsed = JSON.parse(raw);
			this.values = configSchema.parse({ ...DEFAULT_CONFIG, ...parsed });
		} catch {
			this.values = { ...DEFAULT_CONFIG };
		}
	}

	async load(): Promise<void> {
		this.loadSync();
	}

	get<K extends keyof ConfigValues>(key: K): ConfigValues[K] {
		return this.values[key];
	}

	set<K extends keyof ConfigValues>(key: K, value: ConfigValues[K]): void {
		if (!VALID_KEYS.has(key)) {
			throw new Error(`Invalid config key: ${String(key)}`);
		}
		const next = configSchema.parse({ ...this.values, [key]: value });
		this.values = next;
		this.save();
	}

	list(): ConfigValues {
		return { ...this.values };
	}

	reset(): void {
		this.values = { ...DEFAULT_CONFIG };
		this.save();
	}

	private save(): void {
		mkdirSync(dirname(this.configPath), { recursive: true });
		writeFileSync(this.configPath, `${JSON.stringify(this.values, null, 2)}\n`);
	}
}
