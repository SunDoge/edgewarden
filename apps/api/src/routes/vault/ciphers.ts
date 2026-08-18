import { Hono } from "hono";
import type { HonoEnv } from "../../env";
import { createAttachment, deleteAttachment, getAttachment } from "../../handlers/attachments";
import {
	archiveCipher, archiveCiphers, createCipher, deleteCiphers, getCipher,
	hardDeleteCipher, hardDeleteCiphers, importCiphers, listCiphers, moveCiphers,
	putDeleteCipher, restoreCipher, restoreCiphers, unarchiveCipher,
	unarchiveCiphers, updateCipher,
} from "../../handlers/ciphers";
import { requireCipher, requireCipherWrite } from "../../middleware/resources";

export const cipherRoutes = new Hono<HonoEnv>()
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

export const cipherArchiveRoutes = new Hono<HonoEnv>()
	.put("/api/ciphers/:id/archive", requireCipher, requireCipherWrite, ...archiveCipher)
	.post("/api/ciphers/:id/archive", requireCipher, requireCipherWrite, ...archiveCipher)
	.put("/api/ciphers/:id/unarchive", requireCipher, requireCipherWrite, ...unarchiveCipher)
	.post("/api/ciphers/:id/unarchive", requireCipher, requireCipherWrite, ...unarchiveCipher);

export const attachmentRoutes = new Hono<HonoEnv>()
	.post("/api/ciphers/:id/attachment/v2", requireCipher, requireCipherWrite, ...createAttachment)
	.get("/api/ciphers/:id/attachment/:attachmentId", requireCipher, ...getAttachment)
	.post("/api/ciphers/:id/attachment/:attachmentId/delete", requireCipher, requireCipherWrite, ...deleteAttachment)
	.delete("/api/ciphers/:id/attachment/:attachmentId", requireCipher, requireCipherWrite, ...deleteAttachment);
