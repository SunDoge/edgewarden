import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import type { Component } from "svelte";

/** Render a Svelte component with an isolated user-event session. */
export function renderComponent<Props extends Record<string, any>>(
	component: Component<Props>,
	props: Props,
) {
	return {
		...render(component, props),
		user: userEvent.setup(),
	};
}

export { screen, within } from "@testing-library/svelte";
