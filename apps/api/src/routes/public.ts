import { Hono } from "hono";
import type { HonoEnv } from "../env";
import { downloadAttachment, uploadAttachment } from "../handlers/attachments";
import {
  createAuthRequest,
  getAuthRequestResponse,
} from "../handlers/auth-requests";
import { getKnownDevice } from "../handlers/devices";
import {
  checkDigitalAssetLink,
  getFillAssistFile,
  getFillAssistManifest,
} from "../handlers/fill-assist";
import { getWebsiteIcon } from "../handlers/icons";
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
import { connectRealtime, negotiateRealtime } from "../handlers/realtime";
import {
  accessSendFileWithToken,
  accessSendWithToken,
  downloadSendFile,
  uploadPublicSendFile,
} from "../handlers/sends";
import { recoverTwoFactor } from "../handlers/two-factor";
import {
  revocationRequestValidator,
  tokenRequestValidator,
} from "../middleware/validation";

export const publicRouter = new Hono<HonoEnv>()
  .post("/notifications/hub/negotiate", ...negotiateRealtime)
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
  .post("/identity/accounts/recover-2fa", ...recoverTwoFactor)
  .get("/api/devices/knowndevice", ...getKnownDevice)
  .post("/api/auth-requests", ...createAuthRequest)
  .get("/api/auth-requests/:id/response", ...getAuthRequestResponse)
  .get("/fill-assist/manifest.json", ...getFillAssistManifest)
  .get("/fill-assist/:filename", ...getFillAssistFile)
  .get("/.well-known/assetlinks/check", ...checkDigitalAssetLink)
  .get("/icons/:host/icon.png", ...getWebsiteIcon)
  .put("/api/ciphers/:id/attachment/:attachmentId", ...uploadAttachment)
  .get("/api/attachments/download", ...downloadAttachment)
  .post("/api/sends/access", ...accessSendWithToken)
  .post("/api/sends/access/file/:fileId", ...accessSendFileWithToken)
  .get("/api/sends/:idOrAccessId/:fileId", ...downloadSendFile)
  .put("/api/sends/:id/file/:fileId", ...uploadPublicSendFile)
  // Edgewarden owns this flow (bootstrap secret, invite code, and Turnstile).
  // Current Bitwarden registration instead uses identity email verification.
  .post("/api/edgewarden/accounts/register", ...registerAccount)
  .post("/api/accounts/password-hint", ...publicPasswordHint)
  .get("/config", ...getConfig)
  .get("/api/config", ...getConfig)
  .get("/api/health", ...getHealth)
  .get("/api/version", ...getVersion);
