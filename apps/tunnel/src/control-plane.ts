import type { TunnelPolicySnapshot } from "./policy";

/**
 * Stable boundary for a future administration Worker. The control plane owns
 * durable records in D1 and publishes this compact projection for the data
 * plane. Never place D1 queries or admin RPC calls in the per-frame path.
 */
export interface PublishedTunnelPolicy {
	schemaVersion: 1;
	revision: string;
	publishedAt: string;
	credentials: readonly PublishedCredential[];
	defaults: {
		allowedPorts: readonly number[];
		maxPendingBytes: number;
		maxFrameBytes: number;
		connectTimeoutMs: number;
	};
}

export interface PublishedCredential {
	id: string;
	uuid: string;
	enabled: boolean;
	expiresAt?: string;
	allowedPorts?: readonly number[];
	routeId?: string;
}

export interface TunnelUsageEvent {
	schemaVersion: 1;
	event: "connected" | "closed" | "rejected";
	timestamp: number;
	requestId: string;
	credentialId?: string;
	policyRevision?: string;
	destinationPort?: number;
	bytesUp?: number;
	bytesDown?: number;
	reason?: string;
}

export interface PublishedPolicyCompiler {
	compile(policy: PublishedTunnelPolicy): TunnelPolicySnapshot;
}
