-- A request-unique marker lets every statement in a D1 atomic batch prove that
-- its optimistic Cipher update won, even when competing requests share the
-- same second-resolution updated_at candidate.
ALTER TABLE ciphers ADD COLUMN mutation_token TEXT;
