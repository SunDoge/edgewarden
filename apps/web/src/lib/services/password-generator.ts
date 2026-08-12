export type GeneratorMode =
	| "password"
	| "passphrase"
	| "pin"
	| "username"
	| "email"
	| "ssh";

const WORDS = [
	"amber",
	"anchor",
	"apple",
	"atlas",
	"bamboo",
	"beacon",
	"berry",
	"breeze",
	"cactus",
	"canyon",
	"cedar",
	"comet",
	"coral",
	"delta",
	"ember",
	"falcon",
	"forest",
	"galaxy",
	"garden",
	"harbor",
	"hazel",
	"island",
	"jungle",
	"lantern",
	"lemon",
	"lotus",
	"maple",
	"meadow",
	"meteor",
	"mountain",
	"nebula",
	"ocean",
	"olive",
	"orchid",
	"panda",
	"pebble",
	"pepper",
	"planet",
	"quartz",
	"raven",
	"river",
	"rocket",
	"saffron",
	"shadow",
	"silver",
	"spruce",
	"star",
	"summit",
	"sunset",
	"tiger",
	"timber",
	"valley",
	"violet",
	"willow",
	"winter",
	"zephyr",
];

function randomInt(max: number): number {
	if (!Number.isInteger(max) || max <= 0) throw new Error("随机范围无效");
	const limit = Math.floor(0x100000000 / max) * max;
	const values = new Uint32Array(1);
	do crypto.getRandomValues(values);
	while (values[0] >= limit);
	return values[0] % max;
}

function pick(source: string): string {
	return source[randomInt(source.length)];
}

export interface PasswordOptions {
	length: number;
	uppercase: boolean;
	lowercase: boolean;
	numbers: boolean;
	special: boolean;
	avoidAmbiguous: boolean;
	minUppercase?: number;
	minLowercase?: number;
	minNumbers?: number;
	minSpecial?: number;
}

export function generatePassword(options: PasswordOptions): string {
	const groups = [
		options.uppercase
			? { chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", minimum: options.minUppercase }
			: null,
		options.lowercase
			? { chars: "abcdefghijklmnopqrstuvwxyz", minimum: options.minLowercase }
			: null,
		options.numbers
			? { chars: "0123456789", minimum: options.minNumbers }
			: null,
		options.special
			? { chars: "!@#$%^&*()-_=+[]{};:,.?", minimum: options.minSpecial }
			: null,
	].filter((group): group is { chars: string; minimum: number | undefined } =>
		Boolean(group),
	);
	if (!groups.length) throw new Error("至少选择一种字符类型");
	const ambiguous = /[Il1O0o|`'"{}\[\](),.;:]/g;
	const normalized = groups.map((group) => ({
		chars: options.avoidAmbiguous
			? group.chars.replace(ambiguous, "")
			: group.chars,
		minimum: Math.max(1, Math.min(9, Math.floor(group.minimum ?? 1))),
	}));
	const required = normalized.reduce((sum, group) => sum + group.minimum, 0);
	const length = Math.max(required, Math.min(128, Math.floor(options.length)));
	const chars = normalized.flatMap((group) =>
		Array.from({ length: group.minimum }, () => pick(group.chars)),
	);
	const all = normalized.map((group) => group.chars).join("");
	while (chars.length < length) chars.push(pick(all));
	for (let index = chars.length - 1; index > 0; index--) {
		const swap = randomInt(index + 1);
		[chars[index], chars[swap]] = [chars[swap], chars[index]];
	}
	return chars.join("");
}

function resolveWords(customWords?: string): string[] {
	if (!customWords?.trim()) return WORDS;
	const values = [
		...new Set(
			customWords
				.split(/[\s,;]+/)
				.map((word) => word.trim())
				.filter((word) => word.length >= 2 && word.length <= 64),
		),
	];
	if (values.length < 2) throw new Error("自定义词表至少需要两个有效单词");
	return values;
}

export function generatePassphrase(args: {
	words: number;
	separator: string;
	capitalize: boolean;
	includeNumber: boolean;
	customWords?: string;
}): string {
	const count = Math.max(3, Math.min(20, Math.floor(args.words)));
	const source = resolveWords(args.customWords);
	const values = Array.from(
		{ length: count },
		() => source[randomInt(source.length)],
	);
	if (args.capitalize)
		for (let index = 0; index < values.length; index++)
			values[index] = values[index][0].toUpperCase() + values[index].slice(1);
	if (args.includeNumber) values[randomInt(values.length)] += randomInt(10);
	return values.join(args.separator.slice(0, 1));
}

export function generatePin(length: number): string {
	return Array.from(
		{ length: Math.max(3, Math.min(64, Math.floor(length))) },
		() => String(randomInt(10)),
	).join("");
}

export function generateUsername(args: {
	words: number;
	separator: string;
	capitalize: boolean;
	includeNumber: boolean;
	customWords?: string;
	customWord?: string;
}): string {
	const count = Math.max(1, Math.min(10, Math.floor(args.words)));
	const source = resolveWords(args.customWords);
	const values = Array.from(
		{ length: count },
		() => source[randomInt(source.length)],
	);
	if (args.customWord?.trim())
		values.unshift(args.customWord.trim().slice(0, 128));
	if (args.capitalize)
		for (let index = 0; index < values.length; index++)
			values[index] = values[index][0].toUpperCase() + values[index].slice(1);
	if (args.includeNumber) values[randomInt(values.length)] += randomInt(10);
	return values.join(args.separator.slice(0, 1));
}

export function generateEmailAlias(args: {
	email: string;
	mode: "plus" | "catchall" | "subdomain";
	domain?: string;
}): string {
	const token = `${WORDS[randomInt(WORDS.length)]}${randomInt(10000).toString().padStart(4, "0")}`;
	if (args.mode === "catchall") {
		if (!args.domain?.includes(".")) throw new Error("请输入有效的域名");
		return `${token}@${args.domain.trim().toLowerCase()}`;
	}
	const [local, domain] = args.email.trim().toLowerCase().split("@");
	if (!local || !domain) throw new Error("请输入有效的邮箱地址");
	return args.mode === "subdomain"
		? `${local}@${token}.${domain}`
		: `${local}+${token}@${domain}`;
}

export function estimateBits(value: string, mode: GeneratorMode): number {
	if (!value) return 0;
	if (mode === "ssh") return 0;
	if (mode === "passphrase" || mode === "username")
		return Math.round(value.split(/[-_. ]/).length * Math.log2(WORDS.length));
	if (mode === "pin") return Math.round(value.length * Math.log2(10));
	const pool =
		(/[a-z]/.test(value) ? 26 : 0) +
		(/[A-Z]/.test(value) ? 26 : 0) +
		(/\d/.test(value) ? 10 : 0) +
		(/[^A-Za-z0-9]/.test(value) ? 28 : 0);
	return pool ? Math.round(value.length * Math.log2(pool)) : 0;
}
