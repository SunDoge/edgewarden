import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
let folderId = "";
let itemId = "";
let attachmentPath = "";

type BwOptions = {
	session?: string;
	quiet?: boolean;
	appDataDirectory?: string;
};

const execFileAsync = promisify(execFile);

async function bw(args: string[], options: BwOptions = {}): Promise<string> {
	const { stdout, stderr } = await execFileAsync("bw", args, {
		env: {
			...process.env,
			BITWARDENCLI_APPDATA_DIR: options.appDataDirectory ?? appDataDirectory,
			BW_PASSWORD: password,
			...(options.session ? { BW_SESSION: options.session } : {}),
		},
		maxBuffer: 10 * 1024 * 1024,
		timeout: 30_000,
	});
	if (!options.quiet && stderr.trim()) process.stderr.write(stderr);
	return stdout.trim();
}

function encode(value: unknown): string {
	return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

async function cleanup(): Promise<void> {
	if (verificationSession)
		await bw(["logout"], {
			quiet: true,
			appDataDirectory: verificationDirectory,
		}).catch(() => {});
	if (session && itemId)
		await bw(["delete", "item", itemId, "--permanent"], {
			session,
			quiet: true,
		}).catch(() => {});
	if (session && folderId)
		await bw(["delete", "folder", folderId], { session, quiet: true }).catch(
			() => {},
		);
	await bw(["logout"], { quiet: true }).catch(() => {});
	if (appDataDirectory.startsWith(`${tmpdir()}/edgewarden-bw-`)) {
		await rm(appDataDirectory, { recursive: true, force: true });
	}
	if (verificationDirectory.startsWith(`${tmpdir()}/edgewarden-bw-verify-`)) {
		await rm(verificationDirectory, { recursive: true, force: true });
	}
}

try {
	await bw(["config", "server", server], { quiet: true });
	session = await bw(
		["login", email, "--passwordenv", "BW_PASSWORD", "--raw"],
		{ quiet: true },
	);
	await bw(["sync"], { session, quiet: true });

	const folder = JSON.parse(
		await bw(
			[
				"create",
				"folder",
				encode({ name: `Edgewarden CLI smoke ${Date.now()}` }),
			],
			{ session, quiet: true },
		),
	) as { id: string };
	folderId = folder.id;

	const item = JSON.parse(
		await bw(
			[
				"create",
				"item",
				encode({
					type: 1,
					name: "Edgewarden CLI smoke login",
					folderId,
					favorite: false,
					reprompt: 0,
					fields: [],
					login: {
						username: "smoke-user",
						password: "smoke-password",
						uris: [{ match: null, uri: "https://example.com" }],
						totp: null,
					},
				}),
			],
			{ session, quiet: true },
		),
	) as { id: string };
	itemId = item.id;

	await bw(["sync"], { session, quiet: true });
	const roundTripped = JSON.parse(
		await bw(["get", "item", itemId], { session, quiet: true }),
	) as {
		name?: string;
		login?: { username?: string };
	};
	if (
		roundTripped.name !== "Edgewarden CLI smoke login" ||
		roundTripped.login?.username !== "smoke-user"
	) {
		throw new Error("CLI item did not round-trip through sync");
	}

	const edited = JSON.parse(
		await bw(
			[
				"edit",
				"item",
				itemId,
				encode({ ...roundTripped, name: "Edgewarden CLI smoke edited" }),
			],
			{ session, quiet: true },
		),
	) as { name?: string };
	if (edited.name !== "Edgewarden CLI smoke edited") {
		throw new Error("CLI item update did not round-trip");
	}

	await bw(["config", "server", server], {
		quiet: true,
		appDataDirectory: verificationDirectory,
	});
	verificationSession = await bw(
		["login", email, "--passwordenv", "BW_PASSWORD", "--raw"],
		{ quiet: true, appDataDirectory: verificationDirectory },
	);
	await bw(["sync"], {
		session: verificationSession,
		quiet: true,
		appDataDirectory: verificationDirectory,
	});
	const cloudCopy = JSON.parse(
		await bw(["get", "item", itemId], {
			session: verificationSession,
			quiet: true,
			appDataDirectory: verificationDirectory,
		}),
	) as { name?: string };
	if (cloudCopy.name !== "Edgewarden CLI smoke edited") {
		throw new Error("Independent CLI did not receive the saved item update");
	}

	attachmentPath = join(appDataDirectory, "encrypted-smoke-attachment.bin");
	const attachmentBytes = crypto.getRandomValues(new Uint8Array(64));
	await writeFile(attachmentPath, attachmentBytes);
	await bw(
		["create", "attachment", "--file", attachmentPath, "--itemid", itemId],
		{
			session,
			quiet: true,
		},
	);
	const downloadedPath = join(
		appDataDirectory,
		"downloaded-smoke-attachment.bin",
	);
	await bw(
		[
			"get",
			"attachment",
			"encrypted-smoke-attachment.bin",
			"--itemid",
			itemId,
			"--output",
			downloadedPath,
		],
		{ session, quiet: true },
	);
	const downloaded = new Uint8Array(await readFile(downloadedPath));
	if (!downloaded.every((byte, index) => byte === attachmentBytes[index])) {
		throw new Error("CLI attachment bytes did not round-trip");
	}

	await bw(["lock"], { quiet: true });
	session = await bw(["unlock", "--passwordenv", "BW_PASSWORD", "--raw"], {
		quiet: true,
	});
	await bw(["sync"], { session, quiet: true });

	await bw(["delete", "item", itemId, "--permanent"], { session, quiet: true });
	itemId = "";
	await bw(["delete", "folder", folderId], { session, quiet: true });
	folderId = "";
	console.log(
		"Bitwarden CLI login, lock/unlock, sync, item CRUD, and attachment smoke test passed.",
	);
} finally {
	await cleanup();
}
