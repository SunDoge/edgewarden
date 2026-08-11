import { mkdtemp, rm } from "node:fs/promises";
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
let session = "";
let folderId = "";
let itemId = "";
let attachmentPath = "";

type BwOptions = {
	session?: string;
	quiet?: boolean;
};

async function bw(args: string[], options: BwOptions = {}): Promise<string> {
	const child = Bun.spawn(["bw", ...args], {
		env: {
			...process.env,
			BITWARDENCLI_APPDATA_DIR: appDataDirectory,
			BW_PASSWORD: password,
			...(options.session ? { BW_SESSION: options.session } : {}),
		},
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(
			`bw ${args[0] ?? "command"} failed: ${stderr.trim() || stdout.trim() || `exit ${exitCode}`}`,
		);
	}
	if (!options.quiet && stderr.trim()) process.stderr.write(stderr);
	return stdout.trim();
}

function encode(value: unknown): string {
	return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

async function cleanup(): Promise<void> {
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

	attachmentPath = join(appDataDirectory, "encrypted-smoke-attachment.bin");
	const attachmentBytes = crypto.getRandomValues(new Uint8Array(64));
	await Bun.write(attachmentPath, attachmentBytes);
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
	const downloaded = new Uint8Array(
		await Bun.file(downloadedPath).arrayBuffer(),
	);
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
