import { Hono } from "hono";
import type { HonoEnv } from "../env";
import {
	createAccountPasskey,
	deleteAccountPasskey,
	getAccountPasskeyActionAssertionOptions,
	getAccountPasskeyAttestationOptions,
	listAccountPasskeys,
	updateAccountPasskeyEncryption,
} from "../handlers/account-passkeys";
import { createAttachment, deleteAttachment, downloadAttachment } from "../handlers/attachments";
import {
	clearAuditLogs,
	createAdminInvite,
	deleteAdminInvite,
	deleteAdminInvites,
	deleteAdminUser,
	listAdminInvites,
	listAdminUsers,
	listAuditLogs,
	getAuditSettings,
	updateAuditSettings,
	setAdminUserStatus,
} from "../handlers/admin";
import {
	changePassword,
	getApiKey,
	getProfile,
	getRevisionDate,
	requestPasswordHint,
	rotateApiKey,
	setKeys,
	updateProfile,
	verifyAccountPassword,
} from "../handlers/accounts";
import {
	createAuthRequest,
	getAuthRequest,
	listAuthRequests,
	updateAuthRequest,
} from "../handlers/auth-requests";
import {
	deleteRemoteBackup,
	downloadRemoteBackup,
	exportBackup,
	getBackupBlob,
	getBackupSettings,
	importBackup,
	inspectRemoteBackup,
	listRemoteBackups,
	restoreRemoteBackup,
	runBackup,
	updateBackupSettings,
} from "../handlers/backup";
import {
	createCipher,
	deleteCipher,
	deleteCiphers,
	getCipher,
	hardDeleteCipher,
	hardDeleteCiphers,
	importCiphers,
	listCiphers,
	moveCiphers,
	putDeleteCipher,
	restoreCipher,
	restoreCiphers,
	updateCipher,
	archiveCipher,
	unarchiveCipher,
	archiveCiphers,
	unarchiveCiphers,
} from "../handlers/ciphers";
import { getEmptyCompatibilityList } from "../handlers/compatibility";
import {
	deleteAllDevices,
	deleteDevice,
	deleteDevices,
	getDevice,
	getKnownDevice,
	listDevices,
	updateDeviceKeys,
	updateDeviceName,
} from "../handlers/devices";
import { getDomains, updateDomains } from "../handlers/domains";
import {
	createFolder,
	deleteFolder,
	deleteFolders,
	getFolder,
	listFolders,
	updateFolder,
} from "../handlers/folders";
import {
	createFileSend,
	createTextSend,
	deleteSend,
	deleteSends,
	getSend,
	getSendFileUpload,
	listSends,
	removeSendAuth,
	removeSendPassword,
	updateSend,
	uploadSendFile,
} from "../handlers/sends";
import { sync } from "../handlers/sync";
import {
	disableAuthenticator,
	disableTwoFactor,
	enableAuthenticator,
	getAuthenticator,
	getRecoveryCode,
	listTwoFactor,
} from "../handlers/two-factor";
import { createTwoFactorPasskey, deleteTwoFactorPasskey, getTwoFactorPasskeyChallenge, getTwoFactorPasskeys } from "../handlers/two-factor-passkeys";
import { disableYubikeys, getYubikeySettings, saveYubicoConfig, saveYubikeys } from "../handlers/yubikey";
import { createCollection, createOrganization, deleteCollection, deleteOrganization, getInviteePublicKey, getOrganization, inviteOrganizationMember, listCollections, listOrganizationMembers, listOrganizations, removeOrganizationMember, updateOrganizationMember, updateCollection, updateOrganization } from "../handlers/organizations";
import { authMiddleware, requireAdmin } from "../middleware/auth";
import {
	requireAccountPasskey,
	requireAuthRequest,
	requireCipher,
	requireCipherWrite,
	requireDevice,
	requireFolder,
	requireSend,
	requireSendFile,
	requireOrgMember,
	requireOrgManager,
	requireOrgOwner,
	requireCollection,
} from "../middleware/resources";

const accountRoutes = new Hono<HonoEnv>()
	.get("/api/accounts/profile", ...getProfile)
	.put("/api/accounts/profile", ...updateProfile)
	.post("/api/accounts/keys", ...setKeys)
	.post("/api/accounts/password", ...changePassword)
	.post("/api/accounts/verify-password", ...verifyAccountPassword)
	.get("/api/accounts/revision-date", ...getRevisionDate)
	.post("/api/accounts/password-hint", ...requestPasswordHint)
	.get("/api/accounts/api-key", ...getApiKey)
	.post("/api/accounts/api-key", ...getApiKey)
	.post("/api/accounts/rotate-api-key", ...rotateApiKey)
	.get("/api/two-factor", ...listTwoFactor)
	.post("/api/two-factor/get-authenticator", ...getAuthenticator)
	.put("/api/two-factor/authenticator", ...enableAuthenticator)
	.post("/api/two-factor/authenticator", ...enableAuthenticator)
	.delete("/api/two-factor/authenticator", ...disableAuthenticator)
	.post("/api/two-factor/disable", ...disableTwoFactor)
	.post("/api/two-factor/get-recover", ...getRecoveryCode)
	.post("/api/two-factor/get-webauthn", ...getTwoFactorPasskeys)
	.post("/api/two-factor/get-webauthn-challenge", ...getTwoFactorPasskeyChallenge)
	.put("/api/two-factor/webauthn", ...createTwoFactorPasskey)
	.post("/api/two-factor/webauthn", ...createTwoFactorPasskey)
	.delete("/api/two-factor/webauthn", ...deleteTwoFactorPasskey);

const yubikeyEnrollmentRoutes = new Hono<HonoEnv>()
	.post("/settings", ...getYubikeySettings)
	.post("/save", ...saveYubikeys);

const yubikeyControlRoutes = new Hono<HonoEnv>()
	.post("/disable", ...disableYubikeys)
	.put("/config", requireAdmin, ...saveYubicoConfig);

const yubikeyCompatibilityRoutes = new Hono<HonoEnv>()
	.post("/api/two-factor/get-yubikey", ...getYubikeySettings)
	.put("/api/two-factor/yubikey", ...saveYubikeys)
	.post("/api/two-factor/yubikey", ...saveYubikeys)
	.delete("/api/two-factor/yubikey", ...disableYubikeys)
	.put("/api/two-factor/yubikey/config", requireAdmin, ...saveYubicoConfig);

const cipherRoutes = new Hono<HonoEnv>()
	.get("/api/ciphers", ...listCiphers)
	.post("/api/ciphers", ...createCipher)
	.post("/api/ciphers/create", ...createCipher)
	.post("/api/ciphers/import", ...importCiphers)
	.post("/api/ciphers/delete", ...hardDeleteCiphers)
	.put("/api/ciphers/delete", ...deleteCiphers)
	.delete("/api/ciphers", ...hardDeleteCiphers)
	.post("/api/ciphers/delete-permanent", ...hardDeleteCiphers)
	.post("/api/ciphers/restore", ...restoreCiphers)
	.put("/api/ciphers/restore", ...restoreCiphers)
	.put("/api/ciphers/move", ...moveCiphers)
	.post("/api/ciphers/move", ...moveCiphers)
	.put("/api/ciphers/archive", ...archiveCiphers)
	.post("/api/ciphers/archive", ...archiveCiphers)
	.put("/api/ciphers/unarchive", ...unarchiveCiphers)
	.post("/api/ciphers/unarchive", ...unarchiveCiphers)
	.get("/api/ciphers/:id", requireCipher, ...getCipher)
	.put("/api/ciphers/:id", requireCipher, requireCipherWrite, ...updateCipher)
	.post("/api/ciphers/:id", requireCipher, requireCipherWrite, ...updateCipher)
	.delete("/api/ciphers/:id", requireCipher, requireCipherWrite, ...hardDeleteCipher)
	.put("/api/ciphers/:id/delete", requireCipher, requireCipherWrite, ...putDeleteCipher)
	.post("/api/ciphers/:id/delete", requireCipher, requireCipherWrite, ...hardDeleteCipher)
	.delete("/api/ciphers/:id/delete", requireCipher, requireCipherWrite, ...hardDeleteCipher)
	.put("/api/ciphers/:id/restore", requireCipher, requireCipherWrite, ...restoreCipher);

const cipherArchiveRoutes = new Hono<HonoEnv>()
	.put("/api/ciphers/:id/archive", requireCipher, requireCipherWrite, ...archiveCipher)
	.post("/api/ciphers/:id/archive", requireCipher, requireCipherWrite, ...archiveCipher)
	.put("/api/ciphers/:id/unarchive", requireCipher, requireCipherWrite, ...unarchiveCipher)
	.post("/api/ciphers/:id/unarchive", requireCipher, requireCipherWrite, ...unarchiveCipher);

const attachmentRoutes = new Hono<HonoEnv>()
	.post("/api/ciphers/:id/attachment/v2", requireCipher, requireCipherWrite, ...createAttachment)
	.get("/api/ciphers/:id/attachment/:attachmentId", requireCipher, ...downloadAttachment)
	.delete("/api/ciphers/:id/attachment/:attachmentId", requireCipher, requireCipherWrite, ...deleteAttachment);

const folderAndDeviceRoutes = new Hono<HonoEnv>()
	.get("/api/folders", ...listFolders)
	.post("/api/folders", ...createFolder)
	.post("/api/folders/delete", ...deleteFolders)
	.get("/api/folders/:id", requireFolder, ...getFolder)
	.put("/api/folders/:id", requireFolder, ...updateFolder)
	.post("/api/folders/:id", requireFolder, ...updateFolder)
	.post("/api/folders/:id/delete", requireFolder, ...deleteFolder)
	.delete("/api/folders/:id", requireFolder, ...deleteFolder)
	.get("/api/devices", ...listDevices)
	.post("/api/devices/delete", ...deleteDevices)
	.get("/api/devices/knowndevice", ...getKnownDevice)
	.get("/api/devices/identifier/:id", requireDevice, ...getDevice)
	.get("/api/devices/:id", requireDevice, ...getDevice)
	.delete("/api/devices/:id", requireDevice, ...deleteDevice)
	.put("/api/devices/:id/name", requireDevice, ...updateDeviceName)
	.put("/api/devices/:id/keys", requireDevice, ...updateDeviceKeys)
	.delete("/api/devices", ...deleteAllDevices);

const requestAndSettingsRoutes = new Hono<HonoEnv>()
	.post("/api/auth-requests", ...createAuthRequest)
	.get("/api/auth-requests", ...listAuthRequests)
	.get("/api/auth-requests/:id/response", requireAuthRequest, ...getAuthRequest)
	.get("/api/auth-requests/:id", requireAuthRequest, ...getAuthRequest)
	.put("/api/auth-requests/:id", requireAuthRequest, ...updateAuthRequest)
	.get("/api/settings/domains", ...getDomains)
	.put("/api/settings/domains", ...updateDomains)
	.post("/api/settings/domains", ...updateDomains)
	.get("/api/collections", ...getEmptyCompatibilityList)
	.get("/api/policies", ...getEmptyCompatibilityList);

const organizationBaseRoutes = new Hono<HonoEnv>()
	.get("/api/organizations", ...listOrganizations)
	.post("/api/organizations", ...createOrganization)
	.get("/api/organizations/:orgId", requireOrgMember, ...getOrganization)
	.put("/api/organizations/:orgId", requireOrgMember, requireOrgOwner, ...updateOrganization)
	.delete("/api/organizations/:orgId", requireOrgMember, requireOrgOwner, ...deleteOrganization);

const organizationMemberRoutes = new Hono<HonoEnv>()
	.get("/api/organizations/:orgId/invitee", requireOrgMember, requireOrgManager, ...getInviteePublicKey)
	.get("/api/organizations/:orgId/members", requireOrgMember, requireOrgManager, ...listOrganizationMembers)
	.post("/api/organizations/:orgId/members", requireOrgMember, requireOrgManager, ...inviteOrganizationMember)
	.put("/api/organizations/:orgId/members/:memberId", requireOrgMember, requireOrgManager, ...updateOrganizationMember)
	.delete("/api/organizations/:orgId/members/:memberId", requireOrgMember, requireOrgManager, ...removeOrganizationMember);

const organizationCollectionRoutes = new Hono<HonoEnv>()
	.get("/api/organizations/:orgId/collections", requireOrgMember, ...listCollections)
	.post("/api/organizations/:orgId/collections", requireOrgMember, requireOrgManager, ...createCollection)
	.put("/api/organizations/:orgId/collections/:collectionId", requireOrgMember, requireOrgManager, requireCollection, ...updateCollection)
	.delete("/api/organizations/:orgId/collections/:collectionId", requireOrgMember, requireOrgManager, requireCollection, ...deleteCollection);

const backupRoutes = new Hono<HonoEnv>()
	.use("/api/admin/backup/*", requireAdmin)
	.post("/api/admin/backup/export", ...exportBackup)
	.get("/api/admin/backup/blob", ...getBackupBlob)
	.get("/api/admin/backup/settings", ...getBackupSettings)
	.put("/api/admin/backup/settings", ...updateBackupSettings)
	.post("/api/admin/backup/run", ...runBackup)
	.get("/api/admin/backup/remote", ...listRemoteBackups)
	.get("/api/admin/backup/remote/download", ...downloadRemoteBackup)
	.get("/api/admin/backup/remote/integrity", ...inspectRemoteBackup)
	.delete("/api/admin/backup/remote/file", ...deleteRemoteBackup)
	.post("/api/admin/backup/remote/restore", ...restoreRemoteBackup)
	.post("/api/admin/backup/import", ...importBackup);

const adminRoutes = new Hono<HonoEnv>()
	.use("/api/admin/*", requireAdmin)
	.get("/api/admin/users", ...listAdminUsers)
	.put("/api/admin/users/:id/status", ...setAdminUserStatus)
	.delete("/api/admin/users/:id", ...deleteAdminUser)
	.get("/api/admin/invites", ...listAdminInvites)
	.post("/api/admin/invites", ...createAdminInvite)
	.delete("/api/admin/invites/:code", ...deleteAdminInvite)
	.delete("/api/admin/invites", ...deleteAdminInvites)
	.get("/api/admin/logs", ...listAuditLogs)
	.get("/api/admin/logs/settings", ...getAuditSettings)
	.put("/api/admin/logs/settings", ...updateAuditSettings)
	.delete("/api/admin/logs", ...clearAuditLogs);

const apiPasskeyRoutes = new Hono<HonoEnv>()
	.get("/api/webauthn", ...listAccountPasskeys)
	.post(
		"/api/webauthn/attestation-options",
		...getAccountPasskeyAttestationOptions,
	)
	.post(
		"/api/webauthn/assertion-options",
		...getAccountPasskeyActionAssertionOptions,
	)
	.post("/api/webauthn", ...createAccountPasskey)
	.put("/api/webauthn", ...updateAccountPasskeyEncryption)
	.post(
		"/api/webauthn/:id/delete",
		requireAccountPasskey,
		...deleteAccountPasskey,
	);

const compatibilityPasskeyRoutes = new Hono<HonoEnv>()
	.get("/webauthn", ...listAccountPasskeys)
	.post("/webauthn/attestation-options", ...getAccountPasskeyAttestationOptions)
	.post(
		"/webauthn/assertion-options",
		...getAccountPasskeyActionAssertionOptions,
	)
	.post("/webauthn", ...createAccountPasskey)
	.put("/webauthn", ...updateAccountPasskeyEncryption)
	.post("/webauthn/:id/delete", requireAccountPasskey, ...deleteAccountPasskey);

const sendRoutes = new Hono<HonoEnv>()
	.get("/api/sends", ...listSends)
	.post("/api/sends", ...createTextSend)
	.post("/api/sends/file/v2", ...createFileSend)
	.post("/api/sends/delete", ...deleteSends)
	.get("/api/sends/:id", requireSend, ...getSend)
	.put("/api/sends/:id", requireSend, ...updateSend)
	.delete("/api/sends/:id", requireSend, ...deleteSend)
	.put("/api/sends/:id/remove-password", requireSend, ...removeSendPassword)
	.post("/api/sends/:id/remove-password", requireSend, ...removeSendPassword)
	.put("/api/sends/:id/remove-auth", requireSend, ...removeSendAuth)
	.post("/api/sends/:id/remove-auth", requireSend, ...removeSendAuth)
	.get(
		"/api/sends/:id/file/:fileId",
		requireSend,
		requireSendFile,
		...getSendFileUpload,
	)
	.post(
		"/api/sends/:id/file/:fileId",
		requireSend,
		requireSendFile,
		...uploadSendFile,
	)
	.put(
		"/api/sends/:id/file/:fileId",
		requireSend,
		requireSendFile,
		...uploadSendFile,
	);

export const vaultRouter = new Hono<HonoEnv>()
	.use("/api/*", authMiddleware)
	.use("/webauthn/*", authMiddleware)
	.use("/webauthn", authMiddleware)
	.get("/api/sync", ...sync)
	.route("/", accountRoutes)
	.route("/", organizationBaseRoutes)
	.route("/", organizationMemberRoutes)
	.route("/", organizationCollectionRoutes)
	.route("/api/yubico-enrollment", yubikeyEnrollmentRoutes)
	.route("/api/yubico-control", yubikeyControlRoutes)
	.route("/", yubikeyCompatibilityRoutes)
	.route("/", cipherRoutes)
	.route("/", cipherArchiveRoutes)
	.route("/", attachmentRoutes)
	.route("/", folderAndDeviceRoutes)
	.route("/", requestAndSettingsRoutes)
	.route("/", backupRoutes)
	.route("/", adminRoutes)
	.route("/", apiPasskeyRoutes)
	.route("/", compatibilityPasskeyRoutes)
	.route("/", sendRoutes);
