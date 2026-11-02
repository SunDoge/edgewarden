export function browserNotificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function browserNotificationPermission(): NotificationPermission | null {
  return browserNotificationsSupported() ? Notification.permission : null;
}

/** Permission requests must be initiated by a user gesture in modern browsers. */
export async function requestBrowserNotificationPermission(): Promise<NotificationPermission | null> {
  if (!browserNotificationsSupported()) return null;
  return Notification.requestPermission();
}

export function showBrowserNotification(
  title: string,
  options: NotificationOptions & { targetUrl?: string } = {},
): boolean {
  if (browserNotificationPermission() !== "granted") return false;
  const { targetUrl, ...notificationOptions } = options;
  const notification = new Notification(title, notificationOptions);
  notification.onclick = () => {
    window.focus();
    if (targetUrl) window.location.assign(targetUrl);
    notification.close();
  };
  return true;
}
