-- File Send blobs need versioned keys so backup restore can stage content
-- without overwriting the live object before the D1 shadow-table switch.
ALTER TABLE sends ADD COLUMN storage_key TEXT;

UPDATE sends
SET storage_key = 'sends/' || id || '/' || json_extract(data, '$.id')
WHERE type = 1
  AND json_valid(data)
  AND json_type(data, '$.id') = 'text';

CREATE UNIQUE INDEX idx_sends_storage_key
ON sends(storage_key)
WHERE storage_key IS NOT NULL;
