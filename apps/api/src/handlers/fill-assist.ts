import { factory } from "../http/factory";

const FORMS_FILE = "forms.v1.json";
const SCHEMA_FILE = "forms.v1.schema.json";
const FORMS = { schemaVersion: "1.0.0", hosts: {} };
const SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Bitwarden Fill Assist Forms v1",
  type: "object",
  required: ["schemaVersion", "hosts"],
  properties: { schemaVersion: { type: "string" }, hosts: { type: "object" } },
  additionalProperties: true,
};
const MANIFEST = {
  buildId: "edgewarden-empty-fill-assist-v1",
  timestamp: "2026-08-11T00:00:00.000Z",
  gitSha: "edgewarden",
  maps: {
    forms: {
      v1: {
        filename: FORMS_FILE,
        cid: "sha256:189fa7c9bcf8951e65c18b5d9feacf74a5223c75e01667c4235388cbc67091fe",
        schema: SCHEMA_FILE,
        deprecated: false,
      },
    },
  },
};

function json(value: unknown): Response {
  return Response.json(value, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}

export const getFillAssistManifest = factory.createHandlers(async () =>
  json(MANIFEST),
);

export const getFillAssistFile = factory.createHandlers(async (c) => {
  const raw = c.req.param("filename") ?? "";
  let filename = raw;
  try {
    filename = decodeURIComponent(raw);
  } catch {
    /* use the raw route segment */
  }
  if (filename === FORMS_FILE) return json(FORMS);
  if (filename === SCHEMA_FILE) return json(SCHEMA);
  return new Response("Not found", { status: 404 });
});

export const checkDigitalAssetLink = factory.createHandlers(async () =>
  json({
    linked: false,
    maxAge: "86400s",
    debugString:
      "No matching digital asset link policy is configured for this server.",
  }),
);
