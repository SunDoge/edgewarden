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

export function syncDocumentLocale(locale: Locale = getLocale()): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = getTextDirection(locale);
}
