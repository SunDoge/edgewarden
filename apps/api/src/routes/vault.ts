import { Hono } from "hono";
import type { HonoEnv } from "../env";
import { deleteAccount } from "../handlers/account-deletion";
import {
	createAccountPasskey,
	deleteAccountPasskey,
	getAccountPasskeyActionAssertionOptions,
	getAccountPasskeyAttestationOptions,
	listAccountPasskeys,
	updateAccountPasskeyEncryption,
} from "../handlers/account-passkeys";
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
	createAdminInvite,
	deleteAdminInvite,
	deleteAdminInvites,
	deleteAdminUser,
	getAdminRegistrationPolicy,
	getAuditSettings,
	listAdminInvites,
	listAdminUsers,
	listAuditLogs,
	setAdminUserStatus,
	updateAdminRegistrationPolicy,
	updateAuditSettings,
} from "../handlers/admin";
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
import { listUserCollections } from "../handlers/organizations";
import { createRealtimeConnectionTicket } from "../handlers/realtime";
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
import {
	createTwoFactorPasskey,
	deleteTwoFactorPasskey,
	getTwoFactorPasskeyChallenge,
	getTwoFactorPasskeys,
} from "../handlers/two-factor-passkeys";
import {
	disableYubikeys,
	getYubikeySettings,
	saveYubicoConfig,
	saveYubikeys,
} from "../handlers/yubikey";
import { authMiddleware, requireAdmin } from "../middleware/auth";
import { realtimeMutationMiddleware } from "../middleware/realtime";
import {
	requireAccountPasskey,
	requireAuthRequest,
	requireDevice,
	requireFolder,
	requireSend,
	requireSendFile,
} from "../middleware/resources";
import {
	attachmentRoutes,
	cipherArchiveRoutes,
	cipherRoutes,
} from "./vault/ciphers";
import {
	organizationBaseRoutes,
	organizationCollectionRoutes,
	organizationMemberRoutes,
} from "./vault/organizations";

const accountRoutes = new Hono<HonoEnv>()
	.get("/api/accounts/profile", ...getProfile)
	.put("/api/accounts/profile", ...updateProfile)
	.post("/api/accounts/profile", ...updateProfile)
	.post("/api/accounts/keys", ...setKeys)
	.post("/api/accounts/password", ...changePassword)
	.post("/api/accounts/verify-password", ...verifyAccountPassword)
	.get("/api/accounts/revision-date", ...getRevisionDate)
	.post("/api/accounts/password-hint", ...requestPasswordHint)
	.get("/api/accounts/api-key", ...getApiKey)
	.post("/api/accounts/api-key", ...getApiKey)
	.post("/api/accounts/rotate-api-key", ...rotateApiKey)
	.delete("/api/accounts", ...deleteAccount)
	.post("/api/accounts/delete", ...deleteAccount)
	.get("/api/two-factor", ...listTwoFactor)
	.post("/api/two-factor/get-authenticator", ...getAuthenticator)
	.put("/api/two-factor/authenticator", ...enableAuthenticator)
	.post("/api/two-factor/authenticator", ...enableAuthenticator)
	.delete("/api/two-factor/authenticator", ...disableAuthenticator)
	.post("/api/two-factor/disable", ...disableTwoFactor)
	.post("/api/two-factor/get-recover", ...getRecoveryCode)
	.post("/api/two-factor/get-webauthn", ...getTwoFactorPasskeys)
	.post(
		"/api/two-factor/get-webauthn-challenge",
		...getTwoFactorPasskeyChallenge,
	)
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
	.get("/api/collections", ...listUserCollections)
	.get("/api/policies", ...getEmptyCompatibilityList);

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
	.get("/api/admin/registration", ...getAdminRegistrationPolicy)
	.put("/api/admin/registration", ...updateAdminRegistrationPolicy)
	.put("/api/admin/users/:id/status", ...setAdminUserStatus)
	.delete("/api/admin/users/:id", ...deleteAdminUser)
	.get("/api/admin/invites", ...listAdminInvites)
	.post("/api/admin/invites", ...createAdminInvite)
	.delete("/api/admin/invites/:code", ...deleteAdminInvite)
	.delete("/api/admin/invites", ...deleteAdminInvites)
	.get("/api/admin/logs", ...listAuditLogs)
	.get("/api/admin/logs/settings", ...getAuditSettings)
	.put("/api/admin/logs/settings", ...updateAuditSettings);

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
	.use("/api/*", realtimeMutationMiddleware)
	.use("/webauthn/*", authMiddleware)
	.use("/webauthn", authMiddleware)
	.get("/api/sync", ...sync)
	.post("/api/notifications/token", ...createRealtimeConnectionTicket)
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
