// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { renderComponent, screen } from "$lib/../test/component";
import OrganizationCollectionsCard from "./OrganizationCollectionsCard.svelte";

describe("OrganizationCollectionsCard", () => {
	test("enables collection creation after the user enters a name", async () => {
		const onadd = vi.fn();
		const { user } = renderComponent(OrganizationCollectionsCard, {
			organization: { role: "owner" },
			collections: [],
			name: "",
			busy: false,
			onadd,
			onrename: vi.fn(),
			onremove: vi.fn(),
		});

		const addButton = screen.getByRole("button", { name: "添加集合" });
		expect(addButton).toBeDisabled();

		await user.type(screen.getByRole("textbox", { name: "新集合名称" }), "共享");
		expect(addButton).toBeEnabled();
		await user.click(addButton);
		expect(onadd).toHaveBeenCalledOnce();
	});

	test("hides management controls from ordinary members", () => {
		renderComponent(OrganizationCollectionsCard, {
			organization: { role: "member" },
			collections: [{ id: "collection-1", name: "共享" }],
			name: "",
			busy: false,
			onadd: vi.fn(),
			onrename: vi.fn(),
			onremove: vi.fn(),
		});

		expect(screen.getByText("共享")).toBeVisible();
		expect(screen.queryByRole("button", { name: /重命名集合/ })).toBeNull();
	});
});
