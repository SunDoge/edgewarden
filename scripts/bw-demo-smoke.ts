import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DEMO_EMAIL, DEMO_PASSWORD } from "../apps/api/src/demo/policy.ts";

const server = process.env.BW_SERVER;
if (!server) throw new Error("BW_SERVER is required");
const status = await fetch(new URL("/api/demo", server)).then((response) =>
  response.json(),
);
assert.equal(
  status.readOnly,
  true,
  "Refusing write-rejection tests against a non-Demo server",
);
const directory = await mkdtemp(join(tmpdir(), "edgewarden-demo-cli-"));
const exec = promisify(execFile);
let session = "";
async function bw(args: string[]) {
  const { stdout } = await exec("bw", args, {
    env: {
      ...process.env,
      BITWARDENCLI_APPDATA_DIR: directory,
      BW_PASSWORD: DEMO_PASSWORD,
      BW_SESSION: session,
      BW_NOINTERACTION: "true",
    },
    timeout: 60000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64");
try {
  console.log("[bw demo] 登录固定账号并同步");
  await bw(["config", "server", server]);
  session = await bw([
    "login",
    DEMO_EMAIL,
    "--passwordenv",
    "BW_PASSWORD",
    "--raw",
  ]);
  await bw(["sync"]);
  const items = JSON.parse(await bw(["list", "items"])) as Array<{
    id: string;
    name: string;
    type: number;
    login?: { password: string };
    organizationId?: string;
  }>;
  assert.equal(items.length, 5);
  assert.deepEqual(
    [...new Set(items.map((item) => item.type))].sort(),
    [1, 2, 3, 4],
  );
  assert.equal(
    items.find((item) => item.name === "Example website")?.login?.password,
    "Not-A-Real-Password!",
  );
  assert.equal(
    items.find((item) => item.organizationId)?.login?.password,
    "Team-Demo-Only!",
  );
  const sends = JSON.parse(await bw(["send", "list"]));
  assert.equal(
    sends[0]?.text?.text,
    "Welcome to Edgewarden. All content is fictional sample data.",
  );
  const sendUrl = sends[0]?.accessUrl ?? sends[0]?.url;
  assert.equal(typeof sendUrl, "string");
  assert.equal(await bw(["receive", sendUrl]), sends[0].text.text);
  console.log("[bw demo] 确认新增、编辑、删除均被只读边界拒绝");
  const item = items.find((item) => item.name === "Example website")!;
  for (const args of [
    ["create", "folder", encode({ name: "must-not-be-created" })],
    ["edit", "item", item.id, encode({ ...item, name: "must-not-change" })],
    ["delete", "item", item.id],
  ]) {
    await assert.rejects(
      () => bw(args),
      (error) => {
        assert.match(
          String((error as { stderr?: string }).stderr),
          /read-only Demo/,
        );
        return true;
      },
    );
  }
  await bw(["sync"]);
  assert.equal(JSON.parse(await bw(["get", "item", item.id])).name, item.name);
  await bw(["lock"]);
  session = await bw(["unlock", "--passwordenv", "BW_PASSWORD", "--raw"]);
  await bw(["sync"]);
  console.log(
    "Readonly Demo CLI login, decryption, organization, Send, lock/unlock and write rejection passed.",
  );
} finally {
  await bw(["logout"]).catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
