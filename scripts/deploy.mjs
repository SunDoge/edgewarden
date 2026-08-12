import { spawnSync } from "node:child_process";

const useKv = process.argv.includes("--kv");
const migrationScript = useKv ? "db:migrate:remote:kv" : "db:migrate:remote";
const deployScript = useKv ? "deploy:kv" : "deploy";
const missingAutoProvisionedD1 =
	/Couldn't find an auto-provisioned D1 DB .* for binding 'DB'/;

function run(args, capture = false, environment = {}) {
	const result = spawnSync("pnpm", args, {
		encoding: "utf8",
		env: { ...process.env, ...environment },
		stdio: capture ? "pipe" : "inherit",
	});
	if (capture) {
		if (result.stdout) process.stdout.write(result.stdout);
		if (result.stderr) process.stderr.write(result.stderr);
	}
	if (result.error) throw result.error;
	return result;
}

function requireSuccess(result, action) {
	if (result.status === 0) return;
	throw new Error(
		`${action} failed with exit code ${result.status ?? "unknown"}`,
	);
}

const migration = run(["run", migrationScript], true);
if (migration.status === 0) {
	requireSuccess(
		run(["--filter", "@edgewarden/api", "run", deployScript]),
		"Worker deployment",
	);
} else {
	const output = `${migration.stdout ?? ""}\n${migration.stderr ?? ""}`;
	if (!missingAutoProvisionedD1.test(output)) {
		requireSuccess(migration, "D1 migration");
	}

	console.log(
		"D1 has not been provisioned yet; running an initial deployment to create bindings.",
	);
	requireSuccess(
		run(
			["--filter", "@edgewarden/api", "run", deployScript],
			false,
			// Wrangler treats repository config as authoritative in CI. This avoids
			// an interactive Dashboard-config conflict prompt during bootstrap.
			{ CI: "true" },
		),
		"Initial Worker deployment",
	);
	requireSuccess(run(["run", migrationScript]), "D1 migration");
	requireSuccess(
		run(["--filter", "@edgewarden/api", "run", deployScript]),
		"Final Worker deployment",
	);
}
