import { describe, expect, it, vi } from "vitest";
import type { WorkerBindings } from "../worker-bindings";
import {
	getPushRelayStatus,
	publishPushVaultChange,
	registerPushDevice,
} from "./push-relay";

function bindings(values: Partial<WorkerBindings> = {}): WorkerBindings {
	return values as WorkerBindings;
}

describe("Bitwarden push relay", () => {
	it("stays disabled unless both credentials and a valid region are present", () => {
		expect(getPushRelayStatus(bindings())).toEqual({
			enabled: false,
			region: "US",
			installationIdConfigured: false,
			installationKeyConfigured: false,
			reason: "missing_credentials",
		});
		expect(
			getPushRelayStatus(
				bindings({ PUSH_INSTALLATION_ID: "id", PUSH_INSTALLATION_KEY: "key" }),
			),
		).toMatchObject({ enabled: true, region: "US", reason: "ready" });
		expect(
			getPushRelayStatus(
				bindings({
					PUSH_INSTALLATION_ID: "id",
					PUSH_INSTALLATION_KEY: "key",
					PUSH_REGION: "invalid",
				}),
			),
		).toMatchObject({ enabled: false, reason: "invalid_region" });
	});

	it("does not make network requests while disabled", async () => {
		const fetcher = vi.fn();
		await expect(
			publishPushVaultChange(bindings(), "user", null, null, 1, {
				fetcher: fetcher as typeof fetch,
				cache: null,
			}),
		).resolves.toBe(false);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("authenticates and registers a mobile device in the selected region", async () => {
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		const fetcher = vi.fn(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				requests.push({ url, init });
				return url.endsWith("/connect/token")
					? Response.json({ access_token: "relay-token", expires_in: 600 })
					: new Response(null, { status: 200 });
			},
		) as typeof fetch;
		const env = bindings({
			PUSH_INSTALLATION_ID: "installation-id",
			PUSH_INSTALLATION_KEY: "installation-key",
			PUSH_REGION: "EU",
		});

		await expect(
			registerPushDevice(
				env,
				{
					deviceId: "push-id",
					pushToken: "mobile-token",
					userId: "user-id",
					type: 0,
					identifier: "device-id",
					organizationIds: ["org-id"],
				},
				{ fetcher, cache: null },
			),
		).resolves.toBe(true);

		expect(requests.map(({ url }) => url)).toEqual([
			"https://identity.bitwarden.eu/connect/token",
			"https://push.bitwarden.eu/push/register",
		]);
		expect(String(requests[0]?.init?.body)).toContain(
			"client_id=installation.installation-id",
		);
		expect(requests[0]?.init?.body).not.toBeNull();
		expect(requests[1]?.init?.headers).toMatchObject({
			authorization: "Bearer relay-token",
		});
		expect(JSON.parse(String(requests[1]?.init?.body))).toMatchObject({
			deviceId: "push-id",
			pushToken: "mobile-token",
			installationId: "installation-id",
		});
	});

	it("sends the Bitwarden SyncVault payload", async () => {
		const bodies: unknown[] = [];
		const fetcher = vi.fn(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				if (String(input).endsWith("/connect/token"))
					return Response.json({ access_token: "token", expires_in: 600 });
				bodies.push(JSON.parse(String(init?.body)));
				return new Response(null, { status: 200 });
			},
		) as typeof fetch;
		await publishPushVaultChange(
			bindings({
				PUSH_INSTALLATION_ID: "id",
				PUSH_INSTALLATION_KEY: "key",
			}),
			"user-id",
			null,
			"device-id",
			1_786_579_200,
			{ fetcher, cache: null },
		);
		expect(bodies).toEqual([
			{
				userId: "user-id",
				organizationId: null,
				deviceId: null,
				identifier: "device-id",
				type: 5,
				payload: {
					userId: "user-id",
					date: "2026-08-13T00:00:00.000Z",
				},
				clientType: null,
				installationId: null,
			},
		]);
	});
});
