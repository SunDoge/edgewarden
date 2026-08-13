import MiniSearch from "minisearch";
import { match } from "ts-pattern";

export interface AdminUserSearchDocument {
	id: string;
	email: string;
	name?: string | null;
	role: string;
	status: string;
	twoFactorEnabled?: boolean;
}

const WORDS_OR_CJK = /[\p{L}\p{N}]+/gu;
const CJK =
	/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function tokenizeAdminSearch(text: string): string[] {
	const tokens: string[] = [];
	for (const match of text.toLocaleLowerCase().match(WORDS_OR_CJK) ?? []) {
		if (!CJK.test(match)) {
			tokens.push(match);
			continue;
		}
		const characters = Array.from(match);
		tokens.push(...characters);
		for (let index = 0; index < characters.length - 1; index += 1) {
			tokens.push(`${characters[index]}${characters[index + 1]}`);
		}
	}
	return [...new Set(tokens)];
}

export function searchAdminUsers<T extends AdminUserSearchDocument>(
	users: T[],
	query: string,
): T[] {
	if (!query.trim()) return users;
	const search = new MiniSearch<T>({
		fields: ["name", "email", "id", "role", "status", "twoFactor"],
		storeFields: [],
		tokenize: tokenizeAdminSearch,
		extractField: (document, field) =>
			match(field)
				.with("twoFactor", () =>
					document.twoFactorEnabled
						? "2fa two-factor enabled 已启用"
						: "2fa two-factor disabled 未启用",
				)
				.otherwise((key) => String(document[key as keyof T] ?? "")),
	});
	search.addAll(users);
	const byId = new Map(users.map((user) => [user.id, user]));
	return search
		.search(query, {
			prefix: true,
			fuzzy: (term) => (term.length >= 5 ? 0.2 : false),
			combineWith: "AND",
			boost: { email: 4, name: 3, id: 1.5, role: 1, status: 1 },
		})
		.flatMap((result) => {
			const user = byId.get(String(result.id));
			return user ? [user] : [];
		});
}
