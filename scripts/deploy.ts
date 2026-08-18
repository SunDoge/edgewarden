import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	createAttachmentDeploymentConfig,
	type DeploymentConfig,
} from "./wrangler-config.ts";

const useKv = process.argv.includes("--kv");
const healthOrigin = process.env.EDGEWARDEN_HEALTH_URL?.trim();
const root = resolve(import.meta.dirname, "..");
const sourceConfigPath = resolve(root, "wrangler.jsonc");
const temporaryConfigPath = resolve(
	root,
	`.edgewarden-deploy-${process.pid}.jsonc`,
);

const sourceConfig = createAttachmentDeploymentConfig(
	JSON.parse(readFileSync(sourceConfigPath, "utf8")) as DeploymentConfig,
	useKv ? "kv" : "r2",
);
const database = sourceConfig.d1_databases?.find(
	(entry) => entry.binding === "DB",
);
if (!database?.database_name) {
	throw new Error("The DB binding must declare database_name");
}

function wrangler(args: string[], capture = false) {
	const result = spawnSync("pnpm", ["exec", "wrangler", ...args], {
		cwd: root,
		encoding: "utf8",
		env: { ...process.env, CI: "true" },
		stdio: capture ? "pipe" : "inherit",
	});
	if (result.error) throw result.error;
	return result;
}

function requireSuccess(result: ReturnType<typeof spawnSync>, action: string) {
	if (result.status === 0) return;
	const output = [result.stdout, result.stderr]
		.filter((value) => typeof value === "string" && value.trim())
		.map((value) => value.trim())
		.join("\n");
	const permissionHint =
		action.includes("D1") &&
		process.env.WORKERS_CI &&
		/(?:permission|unauthori[sz]ed|forbidden|authentication|not authorized|code.+(?:10000|9109))/i.test(
			output,
		)
			? "\n\nWorkers Builds requires a custom build API token with Account > D1 > Edit. The default generated build token does not include D1 access. Select that token under Worker Settings > Build > API token, then retry the deployment."
			: "";
	throw new Error(
		`${action} failed with exit code ${result.status ?? "unknown"}${output ? `:\n${output}` : ""}${permissionHint}`,
	);
}

async function verifyDeploymentHealth(origin: string): Promise<void> {
	const url = new URL("/api/health", origin);
	let lastFailure = "health endpoint did not respond";

	for (let attempt = 1; attempt <= 10; attempt += 1) {
		try {
			const response = await fetch(url, {
				headers: { accept: "application/json" },
				signal: AbortSignal.timeout(10_000),
			});
			const body = (await response.json()) as { status?: unknown };
			if (response.ok && body.status === "ok") {
				console.log(`Deployment health check passed: ${url}`);
				return;
			}
			lastFailure = `${response.status} ${JSON.stringify(body)}`;
		} catch (error) {
			lastFailure = error instanceof Error ? error.message : String(error);
		}

		if (attempt < 10) {
			await new Promise((resolve) => setTimeout(resolve, 2_000));
		}
	}

	throw new Error(
		`Deployment completed, but ${url} did not become healthy: ${lastFailure}`,
	);
}

interface D1DatabaseEntry {
	name: string;
	uuid: string;
}

function listDatabases(): D1DatabaseEntry[] {
	const result = wrangler(["d1", "list", "--json"], true);
	requireSuccess(result, "Listing D1 databases");
	return JSON.parse(result.stdout) as D1DatabaseEntry[];
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
	let namespace = listNamespaces().find(
		(entry) => entry.title === namespaceTitle,
	);
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
	writeFileSync(
		temporaryConfigPath,
		JSON.stringify(deploymentConfig, null, "\t"),
	);
	// Compile and validate the exact generated configuration before changing D1.
	// A broken Worker bundle must never leave production on a newer schema while
	// the previous Worker version remains active.
	requireSuccess(
		wrangler([
			"deploy",
			"--config",
			temporaryConfigPath,
			"--minify",
			"--dry-run",
		]),
		"Validating Worker deployment",
	);
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
		wrangler(["deploy", "--config", temporaryConfigPath, "--minify"]),
		"Deploying Worker",
	);
	if (healthOrigin) {
		await verifyDeploymentHealth(healthOrigin);
	} else {
		console.warn(
			"Skipping post-deploy health verification because EDGEWARDEN_HEALTH_URL is not configured.",
		);
	}
} finally {
	try {
		unlinkSync(temporaryConfigPath);
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
			console.warn(`Could not remove temporary deploy config: ${error}`);
	}
}
