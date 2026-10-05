import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { authRequestToResponse } from "../apps/api/src/services/auth-requests/presentation.ts";
import { organizationAdminToResponse } from "../apps/api/src/services/organizations/admin-presentation.ts";
import { profileOrganizationToResponse } from "../apps/api/src/services/organizations/profile-presentation.ts";
import {
  authenticatorDetails,
  authenticatorReadResponse,
  authenticatorUpdateResponse,
  twoFactorRecoveryResponse,
  webAuthnDetails,
  webAuthnMutationResponse,
  webAuthnReadResponse,
  yubiKeyDetails,
  yubiKeyReadResponse,
  yubiKeyUpdateResponse,
} from "../apps/api/src/services/two-factor-presentation.ts";

interface CSharpModel {
  base: string | null;
  properties: Map<string, string>;
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? walk(path)
      : entry.isFile() && entry.name.endsWith(".cs")
        ? [path]
        : [];
  });
}

function readModels(serverDirectory: string): Map<string, CSharpModel> {
  const models = new Map<string, CSharpModel>();
  for (const file of walk(resolve(serverDirectory, "src"))) {
    const source = readFileSync(file, "utf8");
    const classes = [
      ...source.matchAll(
        /public\s+(?:abstract\s+)?class\s+(\w+)(?:<[^>{}]+>)?(?:\([^{}]*\))?\s*(?::\s*([^\s({]+)(?:<[^>{}]+>)?)?/g,
      ),
    ];
    for (let index = 0; index < classes.length; index += 1) {
      const match = classes[index];
      const bodyStart = source.indexOf("{", match.index);
      const bodyEnd = classes[index + 1]?.index ?? source.length;
      const body = source.slice(bodyStart, bodyEnd);
      const properties = new Map<string, string>();
      for (const property of body.matchAll(
        /public\s+(?!class\b|static\b|interface\b)([\w?.<>[\], ]+)\s+(\w+)\s*\{\s*get;/g,
      )) {
        properties.set(property[2], property[1].trim());
      }
      models.set(match[1], {
        base: match[2]?.split(".").at(-1) ?? null,
        properties,
      });
    }
  }
  return models;
}

function inheritedProperties(
  models: Map<string, CSharpModel>,
  modelName: string,
  seen = new Set<string>(),
): Map<string, string> {
  if (seen.has(modelName))
    throw new Error(`C# model inheritance cycle at ${modelName}`);
  seen.add(modelName);
  const model = models.get(modelName);
  if (!model) throw new Error(`C# model not found: ${modelName}`);
  const properties =
    model.base && models.has(model.base)
      ? inheritedProperties(models, model.base, seen)
      : new Map<string, string>();
  for (const entry of model.properties) properties.set(...entry);
  return properties;
}

function camelCase(value: string): string {
  return value[0].toLowerCase() + value.slice(1);
}

function checkModel(
  models: Map<string, CSharpModel>,
  modelName: string,
  response: Record<string, unknown>,
): void {
  const properties = inheritedProperties(models, modelName);
  const missing = [...properties.keys()]
    .map(camelCase)
    .filter((property) => !(property in response));
  if (missing.length) {
    throw new Error(`${modelName} is missing fields: ${missing.join(", ")}`);
  }
  const invalid: string[] = [];
  for (const [pascalName, csharpType] of properties) {
    const name = camelCase(pascalName);
    const value = response[name];
    if (value === null || value === undefined) continue;
    const type = csharpType.replace("?", "");
    const expected =
      type === "bool"
        ? "boolean"
        : /^(?:byte|short|int|long|decimal|double)$/.test(type) ||
            type.endsWith("Type")
          ? "number"
          : type === "Guid" || type === "string" || type === "DateTime"
            ? "string"
            : null;
    if (expected && typeof value !== expected) {
      invalid.push(
        `${name} (${typeof value}, expected ${expected} from ${csharpType})`,
      );
    }
  }
  if (invalid.length) {
    throw new Error(
      `${modelName} has invalid field types: ${invalid.join(", ")}`,
    );
  }
  console.log(
    `[contract] ${modelName}: ${Object.keys(response).length} fields, complete`,
  );
}

const serverDirectory = resolve(
  process.env.BITWARDEN_SERVER_DIR ?? "../../csharp/server",
);
if (!existsSync(resolve(serverDirectory, "src"))) {
  throw new Error(
    `Bitwarden server source not found at ${serverDirectory}; set BITWARDEN_SERVER_DIR`,
  );
}

const models = readModels(serverDirectory);
const authRequest = authRequestToResponse(
  {
    id: "auth-request-id",
    request_device_identifier: "device-id",
    request_device_type: 1,
    request_ip_address: "203.0.113.1",
    request_country_name: null,
    public_key: "public-key",
    key: null,
    master_password_hash: null,
    approved: null,
    creation_date: 1_700_000_000,
    response_date: null,
  },
  "vault.example.com",
);
checkModel(models, "AuthRequestResponseModel", authRequest);
checkModel(models, "PendingAuthRequestResponseModel", {
  ...authRequest,
  requestDeviceId: null,
});
const profileOrganization = profileOrganizationToResponse(
  {
    member_id: "member-id",
    org_id: "org-id",
    key: "2.key",
    role: "owner",
    access_all: 1,
    name: "Organization",
    public_key: null,
    private_key: null,
  },
  "user-id",
);
checkModel(models, "ProfileOrganizationResponseModel", profileOrganization);
checkModel(models, "Permissions", profileOrganization.permissions);
const organizationAdmin = organizationAdminToResponse({
  id: "org-id",
  name: "Organization",
  public_key: null,
  private_key: null,
});
checkModel(models, "OrganizationResponseModel", organizationAdmin);
checkModel(models, "PlanResponseModel", organizationAdmin.plan);

const authenticator = authenticatorDetails("JBSWY3DPEHPK3PXP", true);
checkModel(models, "TwoFactorAuthenticatorDetails", authenticator);
checkModel(
  models,
  "TwoFactorAuthenticatorResponseModel",
  authenticatorReadResponse(authenticator, "verification-token"),
);
checkModel(
  models,
  "TwoFactorAuthenticatorUpdateResponseModel",
  authenticatorUpdateResponse(authenticator, "RECOVERY-CODE"),
);
checkModel(
  models,
  "TwoFactorRecoverResponseModel",
  twoFactorRecoveryResponse("RECOVERY-CODE"),
);

const webAuthn = webAuthnDetails([
  {
    aa_guid: null,
    counter: 0,
    created_at: 1_700_000_000,
    credential_id: "credential-id",
    encrypted_private_key: null,
    encrypted_public_key: null,
    encrypted_user_key: null,
    id: "internal-id",
    mutation_token: null,
    name: "Security key",
    provider_key_id: 0,
    public_key: "public-key",
    purpose: "twoFactor",
    supports_prf: 0,
    transports: null,
    type: "public-key",
    updated_at: 1_700_000_000,
    user_id: "user-id",
  },
]);
checkModel(models, "TwoFactorWebAuthnDetails", webAuthn);
checkModel(
  models,
  "TwoFactorWebAuthnResponseModel",
  webAuthnReadResponse(webAuthn, "verification-token"),
);
checkModel(
  models,
  "TwoFactorWebAuthnUpdateResponseModel",
  webAuthnMutationResponse(webAuthn, "update"),
);
checkModel(
  models,
  "TwoFactorWebAuthnDeleteResponseModel",
  webAuthnMutationResponse(webAuthn, "delete"),
);

const yubiKey = yubiKeyDetails(["ccccccbcgujh"], true, {
  configured: true,
  canManageConfig: true,
});
checkModel(models, "TwoFactorYubiKeyDetails", yubiKey);
checkModel(
  models,
  "TwoFactorYubiKeyResponseModel",
  yubiKeyReadResponse(yubiKey, "verification-token"),
);
checkModel(
  models,
  "TwoFactorYubiKeyUpdateResponseModel",
  yubiKeyUpdateResponse(yubiKey),
);
