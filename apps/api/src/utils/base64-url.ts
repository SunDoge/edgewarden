export function encodeBase64Url(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeBase64Url(input: string): Uint8Array | null {
  try {
    let normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4) normalized += "=";
    return Uint8Array.from(atob(normalized), (character) =>
      character.charCodeAt(0),
    );
  } catch {
    return null;
  }
}
