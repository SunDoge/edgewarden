import {
  getLocale,
  getTextDirection,
  type Locale,
} from "$lib/paraglide/runtime.js";

export function formatTime(
  value: Date | number | string,
  locale: Locale = getLocale(),
): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

/** Follow the selected UI language rather than the browser's default locale. */
export function formatDateTime(
  value: Date | number | string,
  locale: Locale = getLocale(),
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatDate(
  value: Date | number | string,
  locale: Locale = getLocale(),
): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(value),
  );
}

export function syncDocumentLocale(locale: Locale = getLocale()): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = getTextDirection(locale);
}
