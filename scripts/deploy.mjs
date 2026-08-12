import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const useKv = process.argv.includes("--kv");
const root = resolve(import.meta.dirname, "..");
const sourceConfigPath = resolve(
	root,
	useKv ? "wrangler.kv.jsonc" : "wrangler.jsonc",
);
const temporaryConfigPath = resolve(
	root,
	`.edgewarden-deploy-${process.pid}.jsonc`,
);
const sourceConfig = JSON.parse(readFileSync(sourceConfigPath, "utf8"));
const database = sourceConfig.d1_databases?.find(
	(entry) => entry.binding === "DB",
);
if (!database?.database_name) {
	throw new Error("The DB binding must declare database_name");
}

function wrangler(args, capture = false) {
	const result = spawnSync("pnpm", ["exec", "wrangler", ...args], {
		cwd: root,
		encoding: "utf8",
		env: { ...process.env, CI: "true" },
		stdio: capture ? "pipe" : "inherit",
	});
	if (result.error) throw result.error;
	return result;
}

function requireSuccess(result, action) {
	if (result.status === 0) return;
	throw new Error(`${action} failed with exit code ${result.status ?? "unknown"}`);
}

function listDatabases() {
	const result = wrangler(["d1", "list", "--json"], true);
	requireSuccess(result, "Listing D1 databases");
	return JSON.parse(result.stdout);
}

function findDatabase() {
	return listDatabases().find((entry) => entry.name === database.database_name);
}

let remoteDatabase = findDatabase();
if (!remoteDatabase) {
	console.log(`Creating D1 database "${database.database_name}"...`);
	const creation = wrangler([
		"d1",
		"create",
		database.database_name,
		"--no-update-config",
	]);
	if (creation.status !== 0) {
		// A concurrent build may have created the database after our list call.
		remoteDatabase = findDatabase();
		if (!remoteDatabase) requireSuccess(creation, "Creating D1 database");
	} else {
		remoteDatabase = findDatabase();
	}
}
if (!remoteDatabase?.uuid) {
	throw new Error(`Could not resolve D1 database "${database.database_name}"`);
}

const deploymentConfig = structuredClone(sourceConfig);
const deploymentDatabase = deploymentConfig.d1_databases.find(
	(entry) => entry.binding === "DB",
);
deploymentDatabase.database_id = remoteDatabase.uuid;

if (useKv) {
	const binding = deploymentConfig.kv_namespaces?.find(
		(entry) => entry.binding === "ATTACHMENTS_KV",
	);
	if (!binding) throw new Error("KV deployment requires ATTACHMENTS_KV");
	const namespaceTitle = `${deploymentConfig.name}-attachments-kv`;
	const listNamespaces = () => {
		const result = wrangler(["kv", "namespace", "list"], true);
		requireSuccess(result, "Listing KV namespaces");
		return JSON.parse(result.stdout);
	};
	let namespace = listNamespaces().find((entry) => entry.title === namespaceTitle);
	if (!namespace) {
		console.log(`Creating KV namespace "${namespaceTitle}"...`);
		const creation = wrangler([
			"kv",
			"namespace",
			"create",
			namespaceTitle,
			"--no-update-config",
		]);
		if (creation.status !== 0) {
			namespace = listNamespaces().find(
				(entry) => entry.title === namespaceTitle,
			);
			if (!namespace) requireSuccess(creation, "Creating KV namespace");
		} else {
			namespace = listNamespaces().find(
				(entry) => entry.title === namespaceTitle,
			);
		}
	}
	if (!namespace?.id) {
		throw new Error(`Could not resolve KV namespace "${namespaceTitle}"`);
	}
	binding.id = namespace.id;
}

try {
	writeFileSync(temporaryConfigPath, JSON.stringify(deploymentConfig, null, "\t"));
	requireSuccess(
		wrangler([
			"d1",
			"migrations",
			"apply",
			"DB",
			"--config",
			temporaryConfigPath,
			"--remote",
		]),
		"Applying D1 migrations",
	);
	requireSuccess(
		wrangler([
			"deploy",
			"--config",
			temporaryConfigPath,
			"--minify",
		]),
		"Deploying Worker",
	);
} finally {
	try {
		unlinkSync(temporaryConfigPath);
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}
}
