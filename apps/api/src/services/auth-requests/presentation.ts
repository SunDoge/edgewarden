import { toIso } from "../../utils/time.ts";

const DEVICE_TYPE_NAMES = [
  "Android",
  "iOS",
  "Chrome Extension",
  "Firefox Extension",
  "Opera Extension",
  "Edge Extension",
  "Windows",
  "macOS",
  "Linux",
  "Chrome",
  "Firefox",
  "Opera",
  "Edge",
  "Internet Explorer",
  "Unknown Browser",
  "Android",
  "UWP",
  "Safari",
  "Vivaldi",
  "Vivaldi Extension",
  "Safari Extension",
  "SDK",
  "Server",
  "Windows CLI",
  "MacOs CLI",
  "Linux CLI",
  "DuckDuckGo",
] as const;

export interface AuthRequestPresentationRow {
  id: string;
  request_device_identifier: string;
  request_device_type: number;
  request_ip_address: string | null;
  request_country_name: string | null;
  public_key: string;
  key: string | null;
  master_password_hash: string | null;
  approved: number | null;
  creation_date: number;
  response_date: number | null;
}

export function authRequestToResponse(
  authRequest: AuthRequestPresentationRow,
  origin: string,
) {
  return {
    id: authRequest.id,
    requestDeviceIdentifier: authRequest.request_device_identifier,
    requestDeviceTypeValue: authRequest.request_device_type,
    requestDeviceType:
      DEVICE_TYPE_NAMES[authRequest.request_device_type] ?? "Unknown Browser",
    requestIpAddress: authRequest.request_ip_address,
    requestCountryName: authRequest.request_country_name,
    publicKey: authRequest.public_key,
    key: authRequest.key,
    masterPasswordHash: authRequest.master_password_hash,
    requestApproved: authRequest.approved === 1,
    origin,
    creationDate: toIso(authRequest.creation_date),
    responseDate:
      authRequest.response_date === null
        ? null
        : toIso(authRequest.response_date),
    object: "auth-request",
  };
}
