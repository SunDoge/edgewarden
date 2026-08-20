import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const server = process.env.BW_SERVER;
const email = process.env.BW_EMAIL;
const password = process.env.BW_PASSWORD;

if (!server || !email || !password) {
  throw new Error(
    "BW_SERVER, BW_EMAIL, and BW_PASSWORD must target a disposable compatibility-test account",
  );
}

const appDataDirectory = await mkdtemp(join(tmpdir(), "edgewarden-bw-"));
const verificationDirectory = await mkdtemp(
  join(tmpdir(), "edgewarden-bw-verify-"),
);
let session = "";
let verificationSession = "";
const folderIds = new Set<string>();
const itemIds = new Set<string>();
const sendIds = new Set<string>();

type BwOptions = {
  session?: string;
  quiet?: boolean;
  appDataDirectory?: string;
  expectFailure?: boolean;
};

type BwItem = {
  id: string;
  name?: string;
  folderId?: string | null;
  favorite?: boolean;
  notes?: string | null;
  login?: {
    username?: string;
    password?: string;
    totp?: string | null;
    uris?: Array<{ match?: number | null; uri?: string }>;
  };
  fields?: Array<{ name?: string; value?: string; type?: number }>;
  attachments?: Array<{ id: string; fileName: string }>;
  deletedDate?: string | null;
  archivedDate?: string | null;
};

type BwSend = {
  id: string;
  accessId?: string;
  accessUrl?: string;
  url?: string;
  name?: string;
};

const execFileAsync = promisify(execFile);

function step(message: string): void {
  console.log(`[bw compat] ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

async function bw(args: string[], options: BwOptions = {}): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync("bw", args, {
      env: {
        ...process.env,
        BITWARDENCLI_APPDATA_DIR: options.appDataDirectory ?? appDataDirectory,
        BW_PASSWORD: password,
        BW_SEND_PASSWORD: "edgewarden-send-password",
        ...(options.session ? { BW_SESSION: options.session } : {}),
      },
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
    });
    if (options.expectFailure) {
      throw new Error(`Command unexpectedly succeeded: bw ${args.join(" ")}`);
    }
    if (!options.quiet && stderr.trim()) process.stderr.write(stderr);
    return stdout.trim();
  } catch (error) {
    if (options.expectFailure) return "";
    throw error;
  }
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

async function json<T>(args: string[], options: BwOptions = {}): Promise<T> {
  return JSON.parse(await bw(args, { ...options, quiet: true })) as T;
}

async function createItem(payload: Record<string, unknown>): Promise<BwItem> {
  const item = await json<BwItem>(["create", "item", encode(payload)], {
    session,
  });
  assert(item.id, "Created item did not include an id");
  itemIds.add(item.id);
  return item;
}

async function getItem(
  id: string,
  profileSession = session,
  profileDirectory = appDataDirectory,
): Promise<BwItem> {
  return json<BwItem>(["get", "item", id], {
    session: profileSession,
    appDataDirectory: profileDirectory,
  });
}

async function sync(
  profileSession = session,
  profileDirectory = appDataDirectory,
): Promise<void> {
  await bw(["sync"], {
    session: profileSession,
    appDataDirectory: profileDirectory,
    quiet: true,
  });
}

async function cleanup(): Promise<void> {
  for (const sendId of sendIds) {
    await bw(["send", "delete", sendId], { session, quiet: true }).catch(
      () => {},
    );
  }
  for (const itemId of itemIds) {
    await bw(["delete", "item", itemId, "--permanent"], {
      session,
      quiet: true,
    }).catch(() => {});
  }
  for (const folderId of folderIds) {
    await bw(["delete", "folder", folderId], {
      session,
      quiet: true,
    }).catch(() => {});
  }
  if (verificationSession) {
    await bw(["logout"], {
      quiet: true,
      appDataDirectory: verificationDirectory,
    }).catch(() => {});
  }
  await bw(["logout"], { quiet: true }).catch(() => {});
  for (const directory of [appDataDirectory, verificationDirectory]) {
    if (directory.startsWith(`${tmpdir()}/edgewarden-bw-`)) {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

try {
  step("配置服务器并验证登录状态");
  await bw(["config", "server", server], { quiet: true });
  session = await bw(
    ["login", email, "--passwordenv", "BW_PASSWORD", "--raw"],
    { quiet: true },
  );
  await sync();
  const status = await json<{
    status: string;
    userEmail?: string;
    serverUrl?: string;
  }>(["status"], { session });
  assertEqual(status.status, "unlocked", "CLI vault status");
  assertEqual(status.userEmail?.toLowerCase(), email.toLowerCase(), "CLI user");
  assert(
    status.serverUrl?.replace(/\/$/, "") === server.replace(/\/$/, ""),
    "CLI status reported a different server",
  );
  await bw(["login", email, "--passwordenv", "BW_PASSWORD", "--raw"], {
    quiet: true,
    expectFailure: true,
  });

  step("创建、编辑和筛选文件夹");
  const folderName = `Edgewarden CLI ${Date.now()}`;
  const folder = await json<{ id: string; name: string }>(
    ["create", "folder", encode({ name: folderName })],
    { session },
  );
  folderIds.add(folder.id);
  const renamedFolder = await json<{ name: string }>(
    [
      "edit",
      "folder",
      folder.id,
      encode({ ...folder, name: `${folderName} renamed` }),
    ],
    { session },
  );
  assertEqual(renamedFolder.name, `${folderName} renamed`, "Folder edit");

  step("验证 Login、Secure Note、Card 和 Identity 项目");
  const loginItem = await createItem({
    type: 1,
    name: "Edgewarden CLI login",
    folderId: folder.id,
    favorite: true,
    reprompt: 0,
    notes: "encrypted login notes",
    fields: [
      { name: "custom-text", value: "custom-value", type: 0 },
      { name: "custom-hidden", value: "hidden-value", type: 1 },
    ],
    login: {
      username: "smoke-user",
      password: "smoke-password",
      uris: [
        { match: null, uri: "https://example.com" },
        { match: 1, uri: "https://accounts.example.com" },
      ],
      totp: "JBSWY3DPEHPK3PXP",
    },
  });
  const noteItem = await createItem({
    type: 2,
    name: "Edgewarden CLI secure note",
    notes: "encrypted secure note",
    favorite: false,
    reprompt: 0,
    fields: [],
    secureNote: { type: 0 },
  });
  const cardItem = await createItem({
    type: 3,
    name: "Edgewarden CLI card",
    favorite: false,
    reprompt: 0,
    fields: [],
    card: {
      cardholderName: "Test Holder",
      brand: "Visa",
      number: "4111111111111111",
      expMonth: "12",
      expYear: "2035",
      code: "123",
    },
  });
  const identityItem = await createItem({
    type: 4,
    name: "Edgewarden CLI identity",
    favorite: false,
    reprompt: 0,
    fields: [],
    identity: {
      title: "Mx",
      firstName: "Edge",
      middleName: "",
      lastName: "Warden",
      address1: "Encrypted Street",
      city: "Test City",
      country: "Test Country",
      email: "identity@example.com",
    },
  });
  await sync();
  const roundTripped = await getItem(loginItem.id);
  assertEqual(roundTripped.login?.username, "smoke-user", "Login username");
  assertEqual(roundTripped.login?.totp, "JBSWY3DPEHPK3PXP", "Login TOTP");
  assertEqual(roundTripped.fields?.length, 2, "Custom fields");
  assertEqual(roundTripped.login?.uris?.length, 2, "Login URIs");
  assertEqual(
    (await getItem(noteItem.id)).notes,
    "encrypted secure note",
    "Note",
  );
  assertEqual((await getItem(cardItem.id)).name, "Edgewarden CLI card", "Card");
  assertEqual(
    (await getItem(identityItem.id)).name,
    "Edgewarden CLI identity",
    "Identity",
  );
  const folderItems = await json<BwItem[]>(
    ["list", "items", "--folderid", folder.id],
    { session },
  );
  assert(
    folderItems.some((item) => item.id === loginItem.id),
    "Folder item filter missed the login item",
  );
  assertEqual(
    await bw(["get", "username", loginItem.id], { session, quiet: true }),
    "smoke-user",
    "Username lookup",
  );
  assertEqual(
    await bw(["get", "password", loginItem.id], { session, quiet: true }),
    "smoke-password",
    "Password lookup",
  );

  step("验证项目编辑、归档、回收站和恢复");
  const edited = await json<BwItem>(
    [
      "edit",
      "item",
      loginItem.id,
      encode({ ...roundTripped, name: "Edgewarden CLI login edited" }),
    ],
    { session },
  );
  assertEqual(edited.name, "Edgewarden CLI login edited", "Item edit");
  await bw(["archive", "item", noteItem.id], { session, quiet: true });
  await sync();
  const archived = await json<BwItem[]>(["list", "items", "--archived"], {
    session,
  });
  assert(
    archived.some((item) => item.id === noteItem.id),
    "Archived item missing",
  );
  await bw(["restore", "item", noteItem.id], { session, quiet: true });
  await bw(["delete", "item", cardItem.id], { session, quiet: true });
  await sync();
  const trash = await json<BwItem[]>(["list", "items", "--trash"], {
    session,
  });
  assert(
    trash.some((item) => item.id === cardItem.id),
    "Deleted item missing from trash",
  );
  await bw(["restore", "item", cardItem.id], { session, quiet: true });
  await sync();
  assert(
    !(await getItem(cardItem.id)).deletedDate,
    "Restored item remained deleted",
  );

  step("使用第二个 CLI 配置验证双向云端同步");
  await bw(["config", "server", server], {
    quiet: true,
    appDataDirectory: verificationDirectory,
  });
  verificationSession = await bw(
    ["login", email, "--passwordenv", "BW_PASSWORD", "--raw"],
    { quiet: true, appDataDirectory: verificationDirectory },
  );
  await sync(verificationSession, verificationDirectory);
  const cloudCopy = await getItem(
    loginItem.id,
    verificationSession,
    verificationDirectory,
  );
  assertEqual(cloudCopy.name, "Edgewarden CLI login edited", "A to B sync");
  const editedByB = await json<BwItem>(
    [
      "edit",
      "item",
      loginItem.id,
      encode({ ...cloudCopy, notes: "edited by verification client" }),
    ],
    { session: verificationSession, appDataDirectory: verificationDirectory },
  );
  assertEqual(editedByB.notes, "edited by verification client", "B edit");
  await sync();
  assertEqual(
    (await getItem(loginItem.id)).notes,
    "edited by verification client",
    "B to A sync",
  );
  await sync();
  assertEqual((await getItem(loginItem.id)).id, loginItem.id, "Repeated sync");

  step("上传、下载、同步和删除附件");
  const attachmentPath = join(
    appDataDirectory,
    "encrypted-smoke-attachment.bin",
  );
  const attachmentBytes = crypto.getRandomValues(new Uint8Array(4096));
  await writeFile(attachmentPath, attachmentBytes);
  await bw(
    [
      "create",
      "attachment",
      "--file",
      attachmentPath,
      "--itemid",
      loginItem.id,
    ],
    { session, quiet: true },
  );
  await sync(verificationSession, verificationDirectory);
  const itemWithAttachment = await getItem(
    loginItem.id,
    verificationSession,
    verificationDirectory,
  );
  const attachment = itemWithAttachment.attachments?.find(
    (candidate) => candidate.fileName === "encrypted-smoke-attachment.bin",
  );
  assert(attachment, "Second CLI did not receive attachment metadata");
  const downloadedPath = join(
    verificationDirectory,
    "downloaded-attachment.bin",
  );
  await bw(
    [
      "get",
      "attachment",
      attachment.id,
      "--itemid",
      loginItem.id,
      "--output",
      downloadedPath,
    ],
    { session: verificationSession, appDataDirectory: verificationDirectory },
  );
  assert(
    Buffer.from(await readFile(downloadedPath)).equals(
      Buffer.from(attachmentBytes),
    ),
    "Attachment bytes did not round-trip",
  );
  await bw(["delete", "attachment", attachment.id, "--itemid", loginItem.id], {
    session,
    quiet: true,
  });
  await sync(verificationSession, verificationDirectory);
  assert(
    !(await getItem(loginItem.id, verificationSession, verificationDirectory))
      .attachments?.length,
    "Attachment deletion did not sync",
  );

  step("创建、匿名读取和删除文本 Send");
  const textSend = await json<BwSend>(
    [
      "send",
      "Edgewarden encrypted send text",
      "--name",
      "Edgewarden CLI text send",
      "--password",
      "edgewarden-send-password",
      "--fullObject",
    ],
    { session },
  );
  sendIds.add(textSend.id);
  const textSendUrl = textSend.accessUrl ?? textSend.url;
  assert(textSendUrl, "Text Send did not return an access URL");
  const receivedText = await bw(
    ["receive", textSendUrl, "--passwordenv", "BW_SEND_PASSWORD"],
    { quiet: true, appDataDirectory: verificationDirectory },
  );
  assertEqual(
    receivedText,
    "Edgewarden encrypted send text",
    "Text Send receive",
  );
  await bw(["send", "delete", textSend.id], { session, quiet: true });
  sendIds.delete(textSend.id);
  await bw(["receive", textSendUrl, "--passwordenv", "BW_SEND_PASSWORD"], {
    quiet: true,
    appDataDirectory: verificationDirectory,
    expectFailure: true,
  });

  step("创建、下载和删除文件 Send");
  const sendFilePath = join(appDataDirectory, "edgewarden-send-file.bin");
  const sendFileBytes = crypto.getRandomValues(new Uint8Array(8192));
  await writeFile(sendFilePath, sendFileBytes);
  const fileSend = await json<BwSend>(
    [
      "send",
      sendFilePath,
      "--file",
      "--name",
      "Edgewarden CLI file send",
      "--fullObject",
    ],
    { session },
  );
  sendIds.add(fileSend.id);
  const fileSendUrl = fileSend.accessUrl ?? fileSend.url;
  assert(fileSendUrl, "File Send did not return an access URL");
  const receivedFilePath = join(
    verificationDirectory,
    "received-send-file.bin",
  );
  await bw(["receive", fileSendUrl, "--output", receivedFilePath], {
    quiet: true,
    appDataDirectory: verificationDirectory,
  });
  assert(
    Buffer.from(await readFile(receivedFilePath)).equals(
      Buffer.from(sendFileBytes),
    ),
    "File Send bytes did not round-trip",
  );
  await bw(["send", "delete", fileSend.id], { session, quiet: true });
  sendIds.delete(fileSend.id);

  step("锁定、拒绝旧会话、解锁并再次同步");
  const lockedSession = session;
  await bw(["lock"], { quiet: true });
  await bw(["sync"], {
    session: lockedSession,
    quiet: true,
    expectFailure: true,
  });
  session = await bw(["unlock", "--passwordenv", "BW_PASSWORD", "--raw"], {
    quiet: true,
  });
  await sync();

  step("永久删除测试资源并验证不可恢复");
  for (const itemId of [...itemIds]) {
    await bw(["delete", "item", itemId, "--permanent"], {
      session,
      quiet: true,
    });
    itemIds.delete(itemId);
    await bw(["get", "item", itemId], {
      session,
      quiet: true,
      expectFailure: true,
    });
  }
  for (const folderId of [...folderIds]) {
    await bw(["delete", "folder", folderId], { session, quiet: true });
    folderIds.delete(folderId);
  }
  console.log(
    "Bitwarden CLI extended compatibility test passed: auth/session, sync, all personal item types, lifecycle, attachments, and Sends.",
  );
} finally {
  await cleanup();
}
