export function formatFileSize(bytes: number | null | undefined): string {
	if (bytes === null || bytes === undefined) return "--";
	if (bytes === 0) return "0 Bytes";
	if (!Number.isFinite(bytes) || bytes < 0) return "--";
	const units = ["Bytes", "KB", "MB", "GB", "TB"];
	const unitIndex = Math.min(
		Math.floor(Math.log(bytes) / Math.log(1024)),
		units.length - 1,
	);
	const value = Number((bytes / 1024 ** unitIndex).toFixed(2));
	return `${value} ${units[unitIndex]}`;
}
