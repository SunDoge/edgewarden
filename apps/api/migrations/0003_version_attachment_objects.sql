-- Store the physical object key separately from the Bitwarden attachment ID.
-- Restore can now stage files under fresh immutable keys and atomically switch
-- the D1 metadata without overwriting files referenced by the live database.
ALTER TABLE attachments ADD COLUMN storage_key TEXT;

UPDATE attachments
SET storage_key = 'attachments/' || cipher_id || '/' || id || '.bin'
WHERE storage_key IS NULL;

CREATE UNIQUE INDEX idx_attachments_storage_key
	ON attachments(storage_key)
	WHERE storage_key IS NOT NULL;
