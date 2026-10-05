const DEVICE_TYPE_VALUES = {
  Android: 0,
  iOS: 1,
  ChromeExtension: 2,
  FirefoxExtension: 3,
  OperaExtension: 4,
  EdgeExtension: 5,
  WindowsDesktop: 6,
  MacOsDesktop: 7,
  LinuxDesktop: 8,
  ChromeBrowser: 9,
  FirefoxBrowser: 10,
  OperaBrowser: 11,
  EdgeBrowser: 12,
  IEBrowser: 13,
  UnknownBrowser: 14,
  AndroidAmazon: 15,
  UWP: 16,
  SafariBrowser: 17,
  VivaldiBrowser: 18,
  VivaldiExtension: 19,
  SafariExtension: 20,
  SDK: 21,
  Server: 22,
  WindowsCLI: 23,
  MacOsCLI: 24,
  LinuxCLI: 25,
  DuckDuckGoBrowser: 26,
} as const;

/** Match ASP.NET Enum.TryParse for Bitwarden's byte-backed DeviceType enum. */
export function parseDeviceTypeHeader(
  value: string | undefined,
): number | null {
  const input = value?.trim();
  if (!input) return null;
  if (/^\d{1,3}$/.test(input)) {
    const numeric = Number(input);
    return numeric <= 255 ? numeric : null;
  }
  return DEVICE_TYPE_VALUES[input as keyof typeof DEVICE_TYPE_VALUES] ?? null;
}
