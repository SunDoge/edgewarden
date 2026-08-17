export const POLICY_SCHEMA_VERSION = 1 as const;

export interface TunnelPolicySnapshot {
	schemaVersion: typeof POLICY_SCHEMA_VERSION;
	revision: string;
	credentials: readonly TunnelCredential[];
	allowedPorts: ReadonlySet<number>;
	maxPendingBytes: number;
	maxFrameBytes: number;
	connectTimeoutMs: number;
}

export interface TunnelCredential {
	id: string;
	uuid: Uint8Array;
	enabled: boolean;
}

export interface PolicyProvider {
	load(request: Request): Promise<TunnelPolicySnapshot>;
}

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class EnvironmentPolicyProvider implements PolicyProvider {
	constructor(private readonly env: CloudflareBindings) {}

	async load(_request: Request): Promise<TunnelPolicySnapshot> {
		const credentials = parseCredentials(this.env.VLESS_UUIDS);
		if (credentials.length === 0) {
			throw new Error("VLESS_UUIDS is not configured");
		}

		return {
			schemaVersion: POLICY_SCHEMA_VERSION,
			revision: "environment",
			credentials,
			allowedPorts: parseAllowedPorts(this.env.ALLOWED_PORTS),
			maxPendingBytes: parseBoundedInteger(
				this.env.MAX_PENDING_BYTES,
				2 * 1024 * 1024,
				64 * 1024,
				16 * 1024 * 1024,
			),
			maxFrameBytes: parseBoundedInteger(
				this.env.MAX_FRAME_BYTES,
				1024 * 1024,
				16 * 1024,
				8 * 1024 * 1024,
			),
			connectTimeoutMs: parseBoundedInteger(
				this.env.CONNECT_TIMEOUT_MS,
				10_000,
				1_000,
				30_000,
			),
		};
	}
}

export function parseUuid(value: string): Uint8Array | null {
	if (!UUID_PATTERN.test(value)) return null;
	const hex = value.replaceAll("-", "");
	const bytes = new Uint8Array(16);
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
	}
	return bytes;
}

export function credentialMatches(
	actual: Uint8Array,
	credential: TunnelCredential,
): boolean {
	if (!credential.enabled || actual.byteLength !== credential.uuid.byteLength) {
		return false;
	}
	let difference = 0;
	for (let index = 0; index < actual.byteLength; index += 1) {
		difference |= actual[index] ^ credential.uuid[index];
	}
	return difference === 0;
}

function parseCredentials(value: string | undefined): TunnelCredential[] {
	return String(value ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => {
			const uuid = parseUuid(entry);
			if (!uuid) throw new Error("VLESS_UUIDS contains an invalid UUID");
			return { id: entry.toLowerCase(), uuid, enabled: true };
		});
}

function parseAllowedPorts(value: string | undefined): ReadonlySet<number> {
	const ports = String(value ?? "80,443")
		.split(",")
		.map((entry) => Number(entry.trim()));
	if (
		ports.length === 0 ||
		ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65_535)
	) {
		throw new Error(
			"ALLOWED_PORTS must be a comma-separated list of TCP ports",
		);
	}
	return new Set(ports);
}

function parseBoundedInteger(
	value: string | undefined,
	fallback: number,
	minimum: number,
	maximum: number,
): number {
	const parsed = value === undefined ? fallback : Number(value);
	if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
		throw new Error(
			`Configured byte limit must be between ${minimum} and ${maximum}`,
		);
	}
	return parsed;
}
