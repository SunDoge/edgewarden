export function errorMessage(value: unknown, fallback: string): string {
  return value instanceof Error && value.message ? value.message : fallback;
}

export function errorDetail(value: unknown): string {
  return value instanceof Error && value.message
    ? value.message
    : String(value);
}
