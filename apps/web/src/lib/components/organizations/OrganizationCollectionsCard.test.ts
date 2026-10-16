// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { changeLocale } from "$lib/i18n/locale.svelte";
import { renderComponent, screen } from "$lib/../test/component";
import OrganizationCollectionsCard from "./OrganizationCollectionsCard.svelte";

describe("OrganizationCollectionsCard", () => {
  beforeEach(() => changeLocale("en"));
  test("enables collection creation after the user enters a name", async () => {
    const onadd = vi.fn();
    const { user } = renderComponent(OrganizationCollectionsCard, {
      organization: { role: "owner", accessAll: true },
      collections: [],
      name: "",
      busy: false,
      onadd,
      onrename: vi.fn(),
      onremove: vi.fn(),
    });

    const addButton = screen.getByRole("button", { name: "Add collection" });
    expect(addButton).toBeDisabled();

    await user.type(
      screen.getByRole("textbox", { name: "New collection name" }),
      "共享",
    );
    expect(addButton).toBeEnabled();
    await user.click(addButton);
    expect(onadd).toHaveBeenCalledOnce();
  });

  test.each(["member", "manager"] as const)(
    "hides management controls from restricted %s",
    (role) => {
      renderComponent(OrganizationCollectionsCard, {
        organization: { role, accessAll: false },
        collections: [{ id: "collection-1", name: "共享" }],
        name: "",
        busy: false,
        onadd: vi.fn(),
        onrename: vi.fn(),
        onremove: vi.fn(),
      });

      expect(screen.getByText("共享")).toBeVisible();
      expect(
        screen.queryByRole("button", { name: /Rename collection/ }),
      ).toBeNull();
    },
  );
});
