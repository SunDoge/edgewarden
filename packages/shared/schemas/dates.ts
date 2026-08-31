import * as v from "valibot";

const APPLE_REFERENCE_DATE_SECONDS = 978_307_200;

/** Accepts web/Android ISO dates and Swift JSONEncoder's reference-date seconds. */
export const NativeDateSchema = v.pipe(
  v.union([
    v.pipe(v.string(), v.isoTimestamp()),
    v.pipe(v.number(), v.finite()),
  ]),
  v.transform((value) =>
    typeof value === "number"
      ? new Date((value + APPLE_REFERENCE_DATE_SECONDS) * 1_000).toISOString()
      : value,
  ),
);
