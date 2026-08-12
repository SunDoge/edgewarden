import { Hono } from "hono";
import type { HonoEnv } from "../env";
import {
	connectToken,
	getPasskeyAssertionOptions,
	prelogin,
	revokeToken,
} from "../handlers/identity";
import {
	getConfig,
	getHealth,
	getVersion,
	publicPasswordHint,
	registerAccount,
} from "../handlers/public";
import {
	accessPublicSend,
	accessPublicSendFile,
	accessSendFileWithToken,
	accessSendWithToken,
	downloadSendFile,
	uploadPublicSendFile,
} from "../handlers/sends";
import { uploadAttachment } from "../handlers/attachments";
import {
	checkDigitalAssetLink,
	getFillAssistFile,
	getFillAssistManifest,
} from "../handlers/fill-assist";
import { recoverTwoFactor } from "../handlers/two-factor";
import { connectRealtime } from "../handlers/realtime";
import { getWebsiteIcon } from "../handlers/icons";
import {
	revocationRequestValidator,
	tokenRequestValidator,
} from "../middleware/validation";

export const publicRouter = new Hono<HonoEnv>()
	.get("/notifications/hub", ...connectRealtime)
	.get("/api/notifications/hub", ...connectRealtime)
	.post("/identity/accounts/prelogin", ...prelogin)
	.post("/identity/accounts/prelogin/password", ...prelogin)
	.get(
		"/identity/accounts/webauthn/assertion-options",
		...getPasskeyAssertionOptions,
	)
	.post("/identity/connect/token", tokenRequestValidator, ...connectToken)
	.post(
		"/identity/connect/revocation",
		revocationRequestValidator,
		...revokeToken,
	)
	.post("/identity/connect/revoke", revocationRequestValidator, ...revokeToken)
	.post("/identity/accounts/recover-2fa", ...recoverTwoFactor)
	.get("/fill-assist/manifest.json", ...getFillAssistManifest)
	.get("/fill-assist/:filename", ...getFillAssistFile)
	.get("/.well-known/assetlinks/check", ...checkDigitalAssetLink)
	.get("/icons/:host/icon.png", ...getWebsiteIcon)
	.put("/api/ciphers/:id/attachment/:attachmentId", ...uploadAttachment)
	.post("/api/sends/access/:idOrAccessId", ...accessPublicSend)
	.post("/api/sends/access", ...accessSendWithToken)
	.post("/api/sends/access/file/:fileId", ...accessSendFileWithToken)
	.post("/api/sends/:idOrAccessId/access/file/:fileId", ...accessPublicSendFile)
	.get("/api/sends/:idOrAccessId/:fileId", ...downloadSendFile)
	.post("/api/sends/:id/file/:fileId", ...uploadPublicSendFile)
	.put("/api/sends/:id/file/:fileId", ...uploadPublicSendFile)
	.post("/api/accounts/register", ...registerAccount)
	.post("/api/accounts/password-hint", ...publicPasswordHint)
	.get("/config", ...getConfig)
	.get("/api/config", ...getConfig)
	.get("/api/health", ...getHealth)
	.get("/api/version", ...getVersion);
