import { join } from "node:path";

export function getPloofDir(baseDir?: string): string {
	if (baseDir) return baseDir;
	if (process.env.PLOOF_HOME) return process.env.PLOOF_HOME;
	return join(process.env.HOME ?? process.cwd(), ".ploof");
}
