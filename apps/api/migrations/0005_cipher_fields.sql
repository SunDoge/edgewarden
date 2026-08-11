-- Keep applied migrations immutable: these columns were added after 0001 had
-- already shipped, so existing D1 databases need an explicit forward migration.
ALTER TABLE ciphers ADD COLUMN fields TEXT;
ALTER TABLE ciphers ADD COLUMN password_history TEXT;
