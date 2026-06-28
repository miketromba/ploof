export function parseParamAssignments(
	values: string[] | string | undefined,
): Record<string, unknown> {
	const params: Record<string, unknown> = {};
	const list =
		values === undefined ? [] : Array.isArray(values) ? values : [values];

	for (const entry of list) {
		const index = entry.indexOf("=");
		if (index === -1) {
			throw new Error(`Invalid --param value "${entry}". Use key=value.`);
		}
		const key = entry.slice(0, index).trim();
		const raw = entry.slice(index + 1).trim();
		if (!key) {
			throw new Error(`Invalid --param value "${entry}". Key is empty.`);
		}
		setNested(params, key, parseScalar(raw));
	}

	return params;
}

export function parseJsonObject(
	value: string | undefined,
): Record<string, unknown> {
	if (!value) return {};
	try {
		const parsed = JSON.parse(value);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("JSON override must be an object.");
		}
		return parsed;
	} catch (err) {
		if (err instanceof Error) {
			throw new Error(`Invalid --json value: ${err.message}`);
		}
		throw err;
	}
}

export function mergeObjects(
	...objects: Array<Record<string, unknown> | undefined>
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const object of objects) {
		if (!object) continue;
		for (const [key, value] of Object.entries(object)) {
			if (isPlainObject(value) && isPlainObject(result[key])) {
				result[key] = mergeObjects(
					result[key] as Record<string, unknown>,
					value as Record<string, unknown>,
				);
			} else {
				result[key] = value;
			}
		}
	}
	return result;
}

function setNested(
	target: Record<string, unknown>,
	path: string,
	value: unknown,
): void {
	const parts = path.split(".").filter(Boolean);
	let current = target;
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i]!;
		if (i === parts.length - 1) {
			current[part] = value;
			return;
		}
		if (!isPlainObject(current[part])) {
			current[part] = {};
		}
		current = current[part] as Record<string, unknown>;
	}
}

function parseScalar(value: string): unknown {
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === "null") return null;
	if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
	if (
		(value.startsWith("{") && value.endsWith("}")) ||
		(value.startsWith("[") && value.endsWith("]"))
	) {
		try {
			return JSON.parse(value);
		} catch {
			return value;
		}
	}
	return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
