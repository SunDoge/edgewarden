/** Current time as Unix seconds */
export const now = (): number => Math.floor(Date.now() / 1000);

/** Unix seconds → ISO 8601 string */
export const toIso = (unix: number): string =>
	new Date(unix * 1000).toISOString();
