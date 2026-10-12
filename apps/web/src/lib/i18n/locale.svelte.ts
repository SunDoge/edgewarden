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

let current = $state<Locale>(initialLocale());

// This is a client-only SPA (ssr=false). Reading the rune from Paraglide's
// getter makes messages reactive without remounting forms or losing vault keys.
overwriteGetLocale(() => current);

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
