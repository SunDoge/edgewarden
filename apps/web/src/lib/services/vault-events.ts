export type VaultEvent =
	| { type: "locked" }
	| { type: "logged-out" }
	| { type: "snapshot-updated"; accountId: string };

type VaultEventEnvelope = { sourceId: string; event: VaultEvent };
type VaultChannel = Pick<
	BroadcastChannel,
	"postMessage" | "addEventListener" | "removeEventListener"
>;

export function createVaultEventBus(channel: VaultChannel, sourceId: string) {
	return {
		broadcast(event: VaultEvent): void {
			channel.postMessage({ sourceId, event } satisfies VaultEventEnvelope);
		},
		subscribe(handler: (event: VaultEvent) => void): () => void {
			const listener = (
				message: MessageEvent<VaultEventEnvelope>,
			) => {
				if (message.data?.sourceId === sourceId || !message.data?.event) return;
				handler(message.data.event);
			};
			channel.addEventListener("message", listener);
			return () => channel.removeEventListener("message", listener);
		},
	};
}

const CHANNEL_NAME = "edgewarden-vault";
const sourceId = crypto.randomUUID();
const channel =
	typeof window === "undefined" || typeof BroadcastChannel === "undefined"
		? null
		: new BroadcastChannel(CHANNEL_NAME);
const eventBus = channel ? createVaultEventBus(channel, sourceId) : null;

export function broadcastVaultEvent(event: VaultEvent): void {
	eventBus?.broadcast(event);
}

export function subscribeToVaultEvents(
	handler: (event: VaultEvent) => void,
): () => void {
	return eventBus?.subscribe(handler) ?? (() => {});
}
