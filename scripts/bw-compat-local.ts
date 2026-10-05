import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import {
  bytesToBase64,
  deriveMasterKey,
  deriveMasterPasswordHash,
  encryptBw,
  hkdfExpand,
} from "../apps/web/src/lib/services/crypto.ts";

const root = resolve(import.meta.dirname, "..");
const persistencePath = await mkdtemp(
  join(tmpdir(), "edgewarden-compat-state-"),
);
const email = `bw-compat-${crypto.randomUUID()}@example.com`;
const password = `BwCompat-${crypto.randomUUID()}-aA1!`;

async function availablePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const socket = createServer();
    socket.unref();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      if (!address || typeof address === "string") {
        socket.close();
        reject(new Error("Could not allocate a local compatibility-test port"));
        return;
      }
      socket.close((error) => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

const port = await availablePort();
let inspectorPort = await availablePort();
while (inspectorPort === port) inspectorPort = await availablePort();
const server = `https://127.0.0.1:${port}`;

async function command(
  args: string[],
  options: {
    completionPattern?: RegExp;
    timeoutMs?: number;
  } = {},
): Promise<void> {
  await new Promise<void>((resolveCommand, reject) => {
    const child = spawn("pnpm", args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "true" },
      detached: process.platform !== "win32",
    });
    let settled = false;
    let completionObserved = false;
    let outputTail = "";
    let completionTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      stopChildProcessGroup(child);
      reject(new Error(`pnpm ${args.join(" ")} timed out`));
    }, options.timeoutMs ?? 60_000);

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (completionTimer) clearTimeout(completionTimer);
      if (error) reject(error);
      else resolveCommand();
    };
    const forward = (target: NodeJS.WriteStream, chunk: Buffer) => {
      target.write(chunk);
      if (!options.completionPattern || completionObserved) return;
      outputTail = `${outputTail}${chunk.toString("utf8")}`.slice(-8_192);
      if (!options.completionPattern.test(outputTail)) return;
      completionObserved = true;
      // Wrangler 4.139 can retain local Miniflare handles after reporting a
      // completed D1 migration. Give it a moment to exit normally, then stop
      // only this detached command group; the success marker is emitted after
      // D1 has committed every statement.
      completionTimer = setTimeout(() => {
        if (settled) return;
        stopChildProcessGroup(child);
      }, 1_000);
    };
    child.stdout.on("data", (chunk: Buffer) => forward(process.stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => forward(process.stderr, chunk));
    child.once("error", (error) => finish(error));
    child.once("exit", (code) => {
      if (code === 0 || completionObserved) finish();
      else finish(new Error(`pnpm ${args.join(" ")} exited with ${code}`));
    });
  });
}

function stopChildProcessGroup(child: ReturnType<typeof spawn>): void {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill("SIGTERM");
    else process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      console.error(
        "Failed to stop compatibility command process group",
        error,
      );
    }
  }
}

async function waitForServer(
  child: ReturnType<typeof spawn>,
  startupError: () => unknown,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (startupError()) throw startupError();
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Local compatibility Worker exited before becoming ready (${child.exitCode ?? child.signalCode})`,
      );
    }
    try {
      const response = await fetch(`${server}/api/config`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error("Local compatibility Worker did not become ready", {
    cause: lastError,
  });
}

async function register(adminPassword: string): Promise<void> {
  const iterations = 600_000;
  const masterKey = await deriveMasterKey(password, email, iterations);
  const masterPasswordHash = await deriveMasterPasswordHash(
    masterKey,
    password,
  );
  const encKey = await hkdfExpand(new Uint8Array(masterKey), "enc", 32);
  const macKey = await hkdfExpand(new Uint8Array(masterKey), "mac", 32);
  const symmetricKey = crypto.getRandomValues(new Uint8Array(64));
  const protectedKey = await encryptBw(symmetricKey, encKey, macKey);
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-1",
    },
    true,
    ["encrypt", "decrypt"],
  );
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey("spki", keyPair.publicKey),
  );
  const privateKey = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
  );
  const encryptedPrivateKey = await encryptBw(
    privateKey,
    symmetricKey.slice(0, 32),
    symmetricKey.slice(32),
  );
  const response = await fetch(`${server}/api/edgewarden/accounts/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      name: "Bitwarden compatibility test",
      masterPasswordHash,
      key: protectedKey,
      kdf: 0,
      kdfIterations: iterations,
      adminPassword,
      keys: { publicKey: bytesToBase64(publicKey), encryptedPrivateKey },
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Local compatibility account registration failed: ${response.status} ${await response.text()}`,
    );
  }
}

// Keep test bindings and secrets independent of the developer's .dev.vars.
const config = JSON.parse(
  await readFile(resolve(root, "wrangler.jsonc"), "utf8"),
);
config.main = resolve(root, config.main);
config.assets.directory = resolve(root, config.assets.directory);
for (const database of config.d1_databases) {
  database.migrations_dir = resolve(root, database.migrations_dir);
}
const certificatePath = join(persistencePath, "localhost.pem");
const certificateKeyPath = join(persistencePath, "localhost-key.pem");
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-keyout",
    certificateKeyPath,
    "-out",
    certificatePath,
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ],
  { stdio: "ignore" },
);
setDefaultCACertificates([
  ...getCACertificates("default"),
  await readFile(certificatePath, "utf8"),
]);
// Child CLI processes trust only this test CA in addition to normal roots.
process.env.NODE_EXTRA_CA_CERTS = certificatePath;
const configPath = join(persistencePath, "wrangler.json");
const bootstrapSecret = crypto.randomUUID() + crypto.randomUUID();
await writeFile(configPath, JSON.stringify(config));
await writeFile(
  join(persistencePath, ".dev.vars"),
  [
    `JWT_SECRET=${crypto.randomUUID()}${crypto.randomUUID()}`,
    `DATA_ENCRYPTION_SECRET=${crypto.randomUUID()}${crypto.randomUUID()}`,
    `BOOTSTRAP_SECRET=${bootstrapSecret}`,
  ].join("\n"),
  { mode: 0o600 },
);

let worker: ReturnType<typeof spawn> | undefined;
let cleanupPromise: Promise<void> | undefined;

function cleanup(): Promise<void> {
  cleanupPromise ??= (async () => {
    if (worker) {
      const child = worker;
      if (child.pid && process.platform !== "win32") {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
            console.error(
              "Failed to stop the compatibility Worker process group",
              error,
            );
            process.exitCode = 1;
            child.kill("SIGTERM");
          }
        }
      } else {
        child.kill("SIGTERM");
      }
      await new Promise<void>((resolveExit) => {
        if (child.exitCode !== null || child.signalCode !== null) resolveExit();
        else child.once("exit", () => resolveExit());
      });
    }
    await rm(persistencePath, { recursive: true, force: true });
  })();
  return cleanupPromise;
}

let handlingSignal = false;
function handleSignal(exitCode: number): void {
  if (handlingSignal) return;
  handlingSignal = true;
  void cleanup().finally(() => process.exit(exitCode));
}
process.once("SIGINT", () => handleSignal(130));
process.once("SIGTERM", () => handleSignal(143));

try {
  await command(
    [
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "DB",
      "--config",
      configPath,
      "--local",
      "--persist-to",
      persistencePath,
    ],
    {
      completionPattern: /commands executed successfully\./,
    },
  );

  worker = spawn(
    "pnpm",
    [
      "exec",
      "wrangler",
      "dev",
      "--local",
      "--config",
      configPath,
      "--port",
      String(port),
      "--inspector-port",
      String(inspectorPort),
      "--local-protocol",
      "https",
      "--https-cert-path",
      certificatePath,
      "--https-key-path",
      certificateKeyPath,
      "--persist-to",
      persistencePath,
    ],
    {
      cwd: root,
      stdio: ["ignore", "inherit", "inherit"],
      detached: process.platform !== "win32",
    },
  );

  let workerStartupError: unknown;
  worker.once("error", (error) => {
    workerStartupError = error;
  });
  await waitForServer(worker, () => workerStartupError);
  await register(bootstrapSecret);
  process.env.BW_SERVER = server;
  process.env.BW_EMAIL = email;
  process.env.BW_PASSWORD = password;
  await import("./bw-compat-smoke.ts");
} finally {
  await cleanup();
}
