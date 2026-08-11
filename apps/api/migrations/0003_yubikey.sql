ALTER TABLE users ADD COLUMN yubikey_config TEXT NOT NULL DEFAULT '{"keys":[],"nfc":false}'
	CHECK (
		json_valid(yubikey_config)
		AND json_type(yubikey_config, '$') = 'object'
		AND json_type(yubikey_config, '$.keys') = 'array'
		AND json_array_length(yubikey_config, '$.keys') <= 5
		AND json_type(yubikey_config, '$.nfc') IN ('true', 'false')
	);
