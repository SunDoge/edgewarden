// Compatibility barrel for existing callers. New code may import a domain module directly.
export type {
	PreloginResponse,
	RegisterPayload,
	SyncResponse,
	TokenResponse,
} from "@edgewarden/shared";
export { KdfType } from "@edgewarden/shared";
export * from "./api-account";
export * from "./api-admin";
export * from "./api-auth";
export * from "./api-backup";
export * from "./api-folders";
export * from "./api-organizations";
export * from "./api-sends";
export * from "./api-vault";
