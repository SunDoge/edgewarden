import {
  baseLocale,
  getLocale,
  isLocale,
  overwriteGetLocale,
  setLocale,
  type Locale,
} from "$lib/paraglide/runtime.js";
import { syncDocumentLocale } from "./format";

function initialLocale(): Locale {
  try {
    return getLocale();
  } catch {
    // Storage may be unavailable in privacy modes; English is still usable.
    return baseLocale;
  }
}

const preferredLocale = initialLocale();
let current = $state<Locale>(baseLocale);

// Match prerendered public HTML on the first client render. Restore the saved
// preference after hydration without remounting forms or losing their input.
overwriteGetLocale(() => current);

export function restoreLocalePreference(): void {
  current = preferredLocale;
}

export function changeLocale(locale: string): void {
  if (!isLocale(locale)) return;
  try {
    setLocale(locale, { reload: false });
  } catch {
    // Keep switching in memory when the browser refuses preference storage.
  }
  current = locale;
  syncDocumentLocale(locale);
}
