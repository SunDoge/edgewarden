import { rpc, rpcJson, rpcVoid } from "./rpc";

export async function fetchBackupSettingsApi(): Promise<any> {
	return rpcJson(await rpc.api.admin.backup.settings.$get());
}

export async function updateBackupSettingsApi(settings: any): Promise<any> {
	return rpcJson(await rpc.api.admin.backup.settings.$put({ json: settings }));
}

export async function runBackupApi(
	destinationId?: string | null,
): Promise<any> {
	return rpcJson(
		await rpc.api.admin.backup.run.$post({
			json: { destinationId: destinationId ?? undefined },
		}),
	);
}

export async function listRemoteBackupsApi(
	destinationId: string,
	path: string,
): Promise<any> {
	return rpcJson(
		await rpc.api.admin.backup.remote.$get({
			query: { destinationId, path },
		}),
	);
}

export async function downloadRemoteBackupApi(
	destinationId: string,
	path: string,
): Promise<Blob> {
	return (
		await rpc.api.admin.backup.remote.download.$get({
			query: { destinationId, path },
		})
	).blob();
}

export async function inspectRemoteBackupApi(
	destinationId: string,
	path: string,
): Promise<any> {
	return rpcJson(
		await rpc.api.admin.backup.remote.integrity.$get({
			query: { destinationId, path },
		}),
	);
}

export async function deleteRemoteBackupApi(
	destinationId: string,
	path: string,
): Promise<void> {
	rpcVoid(
		await rpc.api.admin.backup.remote.file.$delete({
			query: { destinationId, path },
		}),
	);
}

export async function restoreRemoteBackupApi(
	destinationId: string,
	path: string,
	replaceExisting: boolean,
	allowChecksumMismatch: boolean,
): Promise<any> {
	return rpcJson(
		await rpc.api.admin.backup.remote.restore.$post({
			json: {
				destinationId,
				path,
				replaceExisting,
				allowChecksumMismatch,
			},
		}),
	);
}

export async function importBackupLocalApi(
	file: File,
	replaceExisting: boolean,
	allowChecksumMismatch: boolean,
): Promise<any> {
	return rpcJson(
		await rpc.api.admin.backup.import.$post({
			form: {
				file,
				replaceExisting: replaceExisting ? "1" : "0",
				allowChecksumMismatch: allowChecksumMismatch ? "1" : "0",
			},
		}),
	);
}

export async function exportBackupLocalApi(
	includeAttachments: boolean,
): Promise<Blob> {
	return (
		await rpc.api.admin.backup.export.$post({ json: { includeAttachments } })
	).blob();
}
