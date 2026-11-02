// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserNotificationPermission,
  browserNotificationsSupported,
  requestBrowserNotificationPermission,
  showBrowserNotification,
} from "./browser-notifications";

describe("browser notifications", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("stays inert when the browser does not expose notifications", async () => {
    expect(browserNotificationsSupported()).toBe(false);
    expect(browserNotificationPermission()).toBeNull();
    await expect(requestBrowserNotificationPermission()).resolves.toBeNull();
    expect(showBrowserNotification("Request")).toBe(false);
  });

  it("requests permission only through the explicit permission function", async () => {
    const requestPermission = vi.fn().mockResolvedValue("granted");
    vi.stubGlobal(
      "Notification",
      Object.assign(vi.fn(), { permission: "default", requestPermission }),
    );
    await expect(requestBrowserNotificationPermission()).resolves.toBe(
      "granted",
    );
    expect(requestPermission).toHaveBeenCalledOnce();
  });

  it("shows and links a notification after permission was granted", () => {
    const close = vi.fn();
    const NotificationMock = vi.fn(function () {
      return { close, onclick: null };
    });
    Object.assign(NotificationMock, {
      permission: "granted",
      requestPermission: vi.fn(),
    });
    vi.stubGlobal("Notification", NotificationMock);
    expect(
      showBrowserNotification("New device login request", {
        body: "Review the request.",
        targetUrl: "/vault/settings?tab=security",
      }),
    ).toBe(true);
    expect(NotificationMock).toHaveBeenCalledWith(
      "New device login request",
      expect.objectContaining({ body: "Review the request." }),
    );
  });
});
