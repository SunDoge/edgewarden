import { CipherType } from "@edgewarden/shared";
import Papa from "papaparse";
import type {
  TransferDocument,
  TransferItem,
  TransferLogin,
} from "./vault-transfer";

const TYPE_KEYS: Record<number, string> = {
  [CipherType.Login]: "login",
  [CipherType.SecureNote]: "secureNote",
  [CipherType.Card]: "card",
  [CipherType.Identity]: "identity",
  [CipherType.SshKey]: "sshKey",
  [CipherType.BankAccount]: "bankAccount",
  [CipherType.DriversLicense]: "driversLicense",
  [CipherType.Passport]: "passport",
};

function parseCsvRows(text: string): string[][] {
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
    delimiter: ",",
    dynamicTyping: false,
    skipEmptyLines: "greedy",
  });
  const fatal = result.errors.find(
    (error) => error.code !== "TooFewFields" && error.code !== "TooManyFields",
  );
  if (fatal) {
    const location =
      fatal.row === undefined ? "" : `（第 ${fatal.row + 1} 行）`;
    throw new Error(`CSV 格式错误${location}：${fatal.message}`);
  }
  return result.data;
}

function first(record: Record<string, string>, names: string[]): string {
  for (const name of names) if (record[name] != null) return record[name];
  return "";
}

export function parseBitwardenCsv(text: string): TransferDocument {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("CSV 中没有可导入的数据");
  const headers = rows[0].map((value) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[ _-]+/g, ""),
  );
  const folders: Array<{ id: string; name: string }> = [];
  const folderIds = new Map<string, string>();
  const warnings: string[] = [];
  const items: TransferItem[] = rows.slice(1).map((values, rowIndex) => {
    const record = Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    );
    const name =
      first(record, ["name", "title", "sitename", "account"]).trim() ||
      `Imported item ${rowIndex + 1}`;
    const username = first(record, [
      "loginusername",
      "username",
      "user",
      "email",
    ]);
    const password = first(record, ["loginpassword", "password", "pass"]);
    const uri = first(record, ["loginuri", "url", "website", "hostname"]);
    const notes = first(record, ["notes", "extra", "comment"]);
    const folderName = first(record, ["folder", "group", "grouping"]).trim();
    let folderId: string | null = null;
    if (folderName) {
      folderId = folderIds.get(folderName) ?? `csv-folder-${folderIds.size}`;
      if (!folderIds.has(folderName)) {
        folderIds.set(folderName, folderId);
        folders.push({ id: folderId, name: folderName });
      }
    }
    if (!username && !password && !uri && !notes) {
      warnings.push(`第 ${rowIndex + 2} 行缺少常见登录字段`);
    }
    const common = {
      name,
      notes: notes || null,
      favorite: /^(1|true|yes)$/i.test(first(record, ["favorite"])),
      reprompt: Number(first(record, ["reprompt"])) || 0,
      folderId,
    };
    if (first(record, ["type"]).trim().toLowerCase() === "note") {
      return {
        ...common,
        type: CipherType.SecureNote,
        secureNote: { type: 0 },
      };
    }
    return {
      ...common,
      type: CipherType.Login,
      login: {
        username: username || null,
        password: password || null,
        totp: first(record, ["logintotp"]) || null,
        uri: uri || null,
        uris: uri ? [{ uri, match: null }] : [],
      },
    };
  });
  return { folders, items, warnings };
}

export function buildBitwardenCsv(document: TransferDocument): string {
  const folderById = new Map(
    document.folders.map((folder) => [folder.id, folder.name]),
  );
  const rows = [
    [
      "folder",
      "favorite",
      "type",
      "name",
      "notes",
      "fields",
      "reprompt",
      "login_uri",
      "login_username",
      "login_password",
      "login_totp",
    ],
  ];
  for (const item of document.items) {
    const login: TransferLogin = item.login ?? {};
    const csvType = item.type === CipherType.Login ? "login" : "note";
    const typeKey = item.type == null ? undefined : TYPE_KEYS[item.type];
    const extraTypeData =
      csvType === "note" && item.type !== CipherType.SecureNote && typeKey
        ? `\n\n[Edgewarden ${typeKey}]\n${JSON.stringify(item[typeKey] ?? {})}`
        : "";
    rows.push([
      (item.folderId == null ? undefined : folderById.get(item.folderId)) ?? "",
      item.favorite ? "1" : "0",
      csvType,
      item.name ?? "",
      `${item.notes ?? ""}${extraTypeData}`,
      item.fields ? JSON.stringify(item.fields) : "",
      String(item.reprompt ?? 0),
      login.uris?.[0]?.uri ?? login.uri ?? "",
      login.username ?? "",
      login.password ?? "",
      login.totp ?? "",
    ]);
  }
  return Papa.unparse(rows, {
    delimiter: ",",
    header: false,
    newline: "\r\n",
    skipEmptyLines: false,
  });
}
