import { resolve } from "node:path";

const ref = process.env.BITWARDEN_SERVER_REF ?? "main";
const enumPath = "src/Core/Enums/GlobalEquivalentDomainsType.cs";
const storePath = "src/Core/Utilities/StaticStore.cs";
const rawUrl = (path: string) =>
	`https://raw.githubusercontent.com/bitwarden/server/${encodeURIComponent(ref)}/${path}`;
const outputPath = resolve(
	import.meta.dir,
	"../apps/api/src/static/global_domains.bitwarden.json",
);
const metadataPath = resolve(
	import.meta.dir,
	"../apps/api/src/static/global_domains.bitwarden.meta.json",
);

type DomainRule = { type: number; domains: string[]; excluded: false };

export function parseBitwardenDomainRules(
	enumSource: string,
	storeSource: string,
): DomainRule[] {
	const enumBody = enumSource.match(
		/enum\s+GlobalEquivalentDomainsType\b[\s\S]*?\{([\s\S]*?)\}/,
	)?.[1];
	if (!enumBody)
		throw new Error("GlobalEquivalentDomainsType enum was not found");
	const types = new Map<string, number>();
	for (const match of enumBody
		.replace(/\/\/.*$/gm, "")
		.matchAll(/\b([A-Za-z_]\w*)\s*=\s*(\d+)\b/g)) {
		types.set(match[1], Number(match[2]));
	}
	const rules: DomainRule[] = [];
	const rulePattern =
		/GlobalDomains\.Add\s*\(\s*GlobalEquivalentDomainsType\.([A-Za-z_]\w*)\s*,\s*new\s+List(?:<\s*string\s*>)?\s*\{([\s\S]*?)\}\s*\)\s*;/g;
	for (const match of storeSource.matchAll(rulePattern)) {
		const type = types.get(match[1]);
		if (type === undefined) throw new Error(`Unknown domain enum ${match[1]}`);
		const domains = Array.from(
			new Set(
				Array.from(match[2].matchAll(/"((?:\\.|[^"\\])*)"/g), (value) =>
					value[1].replace(/\\"/g, '"').trim().toLowerCase(),
				).filter(Boolean),
			),
		);
		if (domains.length < 2)
			throw new Error(`${match[1]} has fewer than two domains`);
		rules.push({ type, domains, excluded: false });
	}
	if (rules.length < 50)
		throw new Error(
			`Refusing suspicious result with only ${rules.length} rules`,
		);
	return rules;
}

async function fetchSource(path: string): Promise<string> {
	const response = await fetch(rawUrl(path), {
		headers: { accept: "text/plain", "user-agent": "edgewarden-domain-sync" },
	});
	if (!response.ok)
		throw new Error(`Failed to fetch ${path}: ${response.status}`);
	return response.text();
}

async function readJson(path: string): Promise<unknown> {
	try {
		return await Bun.file(path).json();
	} catch {
		return null;
	}
}

async function main(): Promise<void> {
	const [enumSource, storeSource] = await Promise.all([
		fetchSource(enumPath),
		fetchSource(storePath),
	]);
	const rules = parseBitwardenDomainRules(enumSource, storeSource);
	const previousRules = await readJson(outputPath);
	const previousMeta = (await readJson(metadataPath)) as Record<
		string,
		unknown
	> | null;
	const unchanged = JSON.stringify(previousRules) === JSON.stringify(rules);
	if (unchanged) {
		console.log(`Bitwarden domain rules are current (${rules.length} rules).`);
		return;
	}
	if (process.argv.includes("--check"))
		throw new Error("Bitwarden domain rules are out of date");
	await Bun.write(outputPath, `${JSON.stringify(rules, null, "\t")}\n`);
	await Bun.write(
		metadataPath,
		`${JSON.stringify(
			{
				source: "https://github.com/bitwarden/server",
				ref,
				generatedAt:
					previousMeta?.ref === ref && unchanged
						? previousMeta.generatedAt
						: new Date().toISOString(),
				rulesCount: rules.length,
				domainsCount: rules.reduce((sum, rule) => sum + rule.domains.length, 0),
				sourceFiles: [enumPath, storePath],
				sourceUrls: [rawUrl(enumPath), rawUrl(storePath)],
			},
			null,
			"\t",
		)}\n`,
	);
	console.log(`Updated ${rules.length} Bitwarden global domain rules.`);
}

if (import.meta.main) await main();
