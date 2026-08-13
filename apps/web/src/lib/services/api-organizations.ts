import { rpc, rpcJson, rpcVoid } from "./rpc";

export async function listOrganizationsApi(): Promise<any> {
	return rpcJson(await rpc.api.organizations.$get());
}

export async function createOrganizationApi(payload: {
	name: string;
	collectionName: string;
	key: string;
	publicKey: string;
	encryptedPrivateKey: string;
}): Promise<any> {
	return rpcJson(await rpc.api.organizations.$post({ json: payload }));
}

export async function updateOrganizationApi(
	orgId: string,
	name: string,
): Promise<any> {
	return rpcJson(
		await rpc.api.organizations[":orgId"].$put({
			param: { orgId },
			json: { name },
		}),
	);
}

export async function deleteOrganizationApi(
	orgId: string,
	masterPasswordHash: string,
): Promise<void> {
	rpcVoid(
		await rpc.api.organizations[":orgId"].$delete({
			param: { orgId },
			json: { masterPasswordHash },
		}),
	);
}

export async function getOrganizationInviteeApi(
	orgId: string,
	email: string,
): Promise<any> {
	return rpcJson(
		await rpc.api.organizations[":orgId"].invitee.$get({
			param: { orgId },
			query: { email },
		}),
	);
}

export async function listOrganizationMembersApi(orgId: string): Promise<any> {
	return rpcJson(
		await rpc.api.organizations[":orgId"].members.$get({ param: { orgId } }),
	);
}

export async function inviteOrganizationMemberApi(
	orgId: string,
	payload: {
		email: string;
		role: "admin" | "manager" | "member";
		accessAll: boolean;
		collections: Array<{
			id: string;
			readOnly: boolean;
			hidePasswords: boolean;
		}>;
		key: string;
	},
): Promise<any> {
	return rpcJson(
		await rpc.api.organizations[":orgId"].members.$post({
			param: { orgId },
			json: payload,
		}),
	);
}

export async function updateOrganizationMemberApi(
	orgId: string,
	memberId: string,
	payload: {
		role: "admin" | "manager" | "member";
		accessAll: boolean;
		collections: Array<{
			id: string;
			readOnly: boolean;
			hidePasswords: boolean;
		}>;
	},
): Promise<any> {
	return rpcJson(
		await rpc.api.organizations[":orgId"].members[":memberId"].$put({
			param: { orgId, memberId },
			json: payload,
		}),
	);
}

export async function removeOrganizationMemberApi(
	orgId: string,
	memberId: string,
): Promise<void> {
	rpcVoid(
		await rpc.api.organizations[":orgId"].members[":memberId"].$delete({
			param: { orgId, memberId },
		}),
	);
}

export async function listOrganizationCollectionsApi(
	orgId: string,
): Promise<any> {
	return rpcJson(
		await rpc.api.organizations[":orgId"].collections.$get({
			param: { orgId },
		}),
	);
}

export async function createOrganizationCollectionApi(
	orgId: string,
	name: string,
): Promise<any> {
	return rpcJson(
		await rpc.api.organizations[":orgId"].collections.$post({
			param: { orgId },
			json: { name },
		}),
	);
}

export async function updateOrganizationCollectionApi(
	orgId: string,
	collectionId: string,
	name: string,
): Promise<any> {
	return rpcJson(
		await rpc.api.organizations[":orgId"].collections[":collectionId"].$put({
			param: { orgId, collectionId },
			json: { name },
		}),
	);
}

export async function deleteOrganizationCollectionApi(
	orgId: string,
	collectionId: string,
): Promise<void> {
	rpcVoid(
		await rpc.api.organizations[":orgId"].collections[":collectionId"].$delete({
			param: { orgId, collectionId },
		}),
	);
}
