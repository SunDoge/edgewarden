import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const webSource = join(root, "apps/web/src");
const vaultRoutes = join(webSource, "routes/vault");
const violations: string[] = [];

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return /\.(?:svelte|ts)$/.test(entry.name) ? [path] : [];
	});
}

for (const file of sourceFiles(webSource)) {
	const source = readFileSync(file, "utf8");
	if (
		source.includes('from "$lib/services/api"') ||
		source.includes('from "./api"')
	) {
		violations.push(`${file}: import a specific api-* domain module`);
	}
	const isProductionSource =
		!/\.test\.ts$/.test(file) && !file.endsWith(".d.ts");
	if (
		isProductionSource &&
		/(?:\bas\s+any\b|:\s*any\b|Promise<any>|<any(?:\[\])?[>,])/.test(source)
	) {
		violations.push(
			`${file}: production Web code must use explicit domain types, not any`,
		);
	}
}

const vaultPage = join(vaultRoutes, "+page.svelte");
const vaultPageSource = readFileSync(vaultPage, "utf8");
for (const manager of [
	"createVaultAttachmentManager",
	"createVaultBulkManager",
	"createVaultFolderManager",
	"createVaultItemManager",
]) {
	if (!vaultPageSource.includes(manager))
		violations.push(`${vaultPage}: vault orchestration must use ${manager}`);
}
if (vaultPageSource.includes("services/api-"))
	violations.push(`${vaultPage}: vault mutations belong in domain controllers`);

const organizationsPage = join(vaultRoutes, "organizations/+page.svelte");
const organizationsPageSource = readFileSync(organizationsPage, "utf8");
if (!organizationsPageSource.includes("createOrganizationManager"))
	violations.push(
		`${organizationsPage}: organization orchestration belongs in its domain controller`,
	);
if (organizationsPageSource.includes("services/api-"))
	violations.push(
		`${organizationsPage}: organization APIs belong in the domain controller`,
	);

for (const entry of readdirSync(vaultRoutes, { withFileTypes: true })) {
	if (!entry.isDirectory() || entry.name === "unlock") continue;
	const page = join(vaultRoutes, entry.name, "+page.svelte");
	if (!existsSync(page)) continue;
	const source = readFileSync(page, "utf8");
	if (!source.includes("VaultPageShell"))
		violations.push(`${page}: nested vault routes must use VaultPageShell`);
	if (source.includes("isLoggedIn()") || source.includes('goto("/vault/unlock'))
		violations.push(
			`${page}: authentication and unlock guards belong in +layout.svelte`,
		);
}

const retiredFolderSidebar = join(
	webSource,
	"lib/components/vault/VaultFolderSidebar.svelte",
);
if (existsSync(retiredFolderSidebar))
	violations.push(`${retiredFolderSidebar}: obsolete standalone folder column`);

if (violations.length) {
	throw new Error(`Web architecture checks failed:\n${violations.join("\n")}`);
}

console.log(
	"Web route shells, lifecycle guards, domain controllers, API boundaries, and production types are valid.",
);
