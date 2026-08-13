import type { BackupDestinationRecord } from "@edgewarden/shared";

// The Worker runs once per hour. Backup schedules therefore select a local
// hour, not an exact minute; the configured slot remains due for that hour.
export const BACKUP_SCHEDULER_WINDOW_MINUTES = 60;

export function normalizeBackupStartTime(
	value: unknown,
	fallback = "03:00",
): string {
	const raw = String(value ?? "").trim() || fallback;
	const match = raw.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
	if (!match) throw new Error("Backup start time must be in HH:mm format");
	const hour = Number(match[1]);
	const minute = Number(match[2] ?? "0");
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
		throw new Error("Backup start time must be in HH:mm format");
	}
	return `${String(hour).padStart(2, "0")}:00`;
}

function getDateTimeParts(
	date: Date,
	timezone: string,
): { year: string; month: string; day: string; hour: string; minute: string } {
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	});
	const parts = formatter.formatToParts(date);
	const pick = (type: string): string =>
		parts.find((part) => part.type === type)?.value || "";
	return {
		year: pick("year"),
		month: pick("month"),
		day: pick("day"),
		hour: pick("hour"),
		minute: pick("minute"),
	};
}

export function getBackupLocalDateKey(date: Date, timezone: string): string {
	const parts = getDateTimeParts(date, timezone);
	return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getBackupLocalTime(date: Date, timezone: string): string {
	const parts = getDateTimeParts(date, timezone);
	return `${parts.hour}:${parts.minute}`;
}

function parseLocalDateKey(
	dateKey: string,
): { year: number; month: number; day: number } | null {
	const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (
		!Number.isInteger(year) ||
		!Number.isInteger(month) ||
		!Number.isInteger(day)
	)
		return null;
	return { year, month, day };
}

function getUtcDateForLocalTime(
	timezone: string,
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
): Date {
	const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
	const actual = getDateTimeParts(new Date(utcGuess), timezone);
	const actualUtc = Date.UTC(
		Number(actual.year),
		Number(actual.month) - 1,
		Number(actual.day),
		Number(actual.hour),
		Number(actual.minute),
		0,
		0,
	);
	const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
	return new Date(utcGuess - (actualUtc - desiredUtc));
}

function getBackupSlotStartsForLocalDay(
	dateKey: string,
	timezone: string,
	startTime: string,
	intervalHours: number,
): Date[] {
	const parsedDate = parseLocalDateKey(dateKey);
	const parsedTime = normalizeBackupStartTime(startTime)
		.split(":")
		.map((value) => Number(value));
	if (!parsedDate || parsedTime.length !== 2) return [];

	const [hour, minute] = parsedTime;
	const firstSlot = getUtcDateForLocalTime(
		timezone,
		parsedDate.year,
		parsedDate.month,
		parsedDate.day,
		hour,
		minute,
	);
	const nextLocalDay = new Date(
		Date.UTC(parsedDate.year, parsedDate.month - 1, parsedDate.day, 0, 0, 0, 0),
	);
	nextLocalDay.setUTCDate(nextLocalDay.getUTCDate() + 1);
	const nextDay = getUtcDateForLocalTime(
		timezone,
		nextLocalDay.getUTCFullYear(),
		nextLocalDay.getUTCMonth() + 1,
		nextLocalDay.getUTCDate(),
		0,
		0,
	);
	const intervalMs = intervalHours * 60 * 60 * 1000;
	const slots: Date[] = [];

	for (
		let slotMs = firstSlot.getTime();
		slotMs < nextDay.getTime();
		slotMs += intervalMs
	) {
		slots.push(new Date(slotMs));
	}
	return slots;
}

export function hasBackupSlotBetween(
	destination: BackupDestinationRecord,
	startInclusive: Date,
	endExclusive: Date,
): boolean {
	if (!destination.schedule.enabled) return false;
	const startMs = startInclusive.getTime();
	const endMs = endExclusive.getTime();
	if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs)
		return false;

	const lastAttemptAt = destination.runtime.lastAttemptAt
		? new Date(destination.runtime.lastAttemptAt)
		: null;
	const lastAttemptMs =
		lastAttemptAt && Number.isFinite(lastAttemptAt.getTime())
			? lastAttemptAt.getTime()
			: Number.NEGATIVE_INFINITY;

	const dayCursor = new Date(startMs);
	dayCursor.setUTCHours(0, 0, 0, 0);
	const endDay = new Date(endMs);
	endDay.setUTCHours(0, 0, 0, 0);
	const checkedLocalDateKeys = new Set<string>();

	while (dayCursor.getTime() <= endDay.getTime() + 24 * 60 * 60 * 1000) {
		const localDateKey = getBackupLocalDateKey(
			dayCursor,
			destination.schedule.timezone,
		);
		if (!checkedLocalDateKeys.has(localDateKey)) {
			checkedLocalDateKeys.add(localDateKey);
			const slotStarts = getBackupSlotStartsForLocalDay(
				localDateKey,
				destination.schedule.timezone,
				destination.schedule.startTime,
				destination.schedule.intervalHours,
			);
			for (const slotStart of slotStarts) {
				const slotStartMs = slotStart.getTime();
				if (slotStartMs < startMs || slotStartMs >= endMs) continue;
				if (lastAttemptMs >= slotStartMs) continue;
				return true;
			}
		}
		dayCursor.setUTCDate(dayCursor.getUTCDate() + 1);
	}

	return false;
}

export function isBackupDueNow(
	destination: BackupDestinationRecord,
	now: Date,
	windowMinutes: number = BACKUP_SCHEDULER_WINDOW_MINUTES,
): boolean {
	if (!destination.schedule.enabled) return false;
	const toleranceMs = Math.max(1, windowMinutes) * 60 * 1000;
	const lastAttemptAt = destination.runtime.lastAttemptAt
		? new Date(destination.runtime.lastAttemptAt)
		: null;
	const lastAttemptMs =
		lastAttemptAt && Number.isFinite(lastAttemptAt.getTime())
			? lastAttemptAt.getTime()
			: Number.NEGATIVE_INFINITY;
	const localDateKey = getBackupLocalDateKey(
		now,
		destination.schedule.timezone,
	);
	const slotStarts = getBackupSlotStartsForLocalDay(
		localDateKey,
		destination.schedule.timezone,
		destination.schedule.startTime,
		destination.schedule.intervalHours,
	);

	for (const slotStart of slotStarts) {
		const slotStartMs = slotStart.getTime();
		if (
			now.getTime() < slotStartMs ||
			now.getTime() >= slotStartMs + toleranceMs
		)
			continue;
		if (lastAttemptMs >= slotStartMs) return false;
		return true;
	}
	return false;
}
