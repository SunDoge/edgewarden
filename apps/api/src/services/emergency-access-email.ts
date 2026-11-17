import type { TransactionalEmail } from "./email";
import { escapeEmailHtml } from "./email";

type AccessEvent =
  | "invited"
  | "confirmed"
  | "requested"
  | "approved"
  | "rejected"
  | "takeover";

const copy: Record<AccessEvent, (actor: string) => string> = {
  invited: (actor) =>
    `${actor} added you as an emergency contact. Sign in to review the emergency access relationship.`,
  confirmed: (actor) =>
    `${actor} confirmed your emergency access relationship. You can request access when it is needed.`,
  requested: (actor) =>
    `${actor} requested emergency access to your vault. Sign in to approve or reject the request.`,
  approved: (actor) =>
    `${actor} approved your emergency access request. Sign in to continue.`,
  rejected: (actor) => `${actor} rejected your emergency access request.`,
  takeover: (actor) =>
    `${actor} completed an emergency account takeover. Your password and active sessions were reset.`,
};

const subjects: Record<AccessEvent, string> = {
  invited: "You were added as an emergency contact",
  confirmed: "Emergency access was confirmed",
  requested: "Emergency access was requested",
  approved: "Emergency access was approved",
  rejected: "Emergency access was rejected",
  takeover: "Emergency account takeover completed",
};

export function emergencyAccessEmail(input: {
  event: AccessEvent;
  to: string;
  actorName: string | null;
  actorEmail: string;
  requestUrl: string;
  privacyMode?: string;
}): TransactionalEmail {
  if (input.privacyMode?.trim().toLowerCase() !== "detailed") {
    const settingsUrl = new URL(
      "/vault/settings?tab=security",
      input.requestUrl,
    );
    const safeUrl = escapeEmailHtml(settingsUrl.href);
    return {
      to: input.to,
      subject: "Edgewarden security notification",
      text: `Security activity requires your attention. Sign in to Edgewarden to review it.\n\nOpen Edgewarden: ${settingsUrl.href}`,
      html: `<p>Security activity requires your attention. Sign in to Edgewarden to review it.</p><p><a href="${safeUrl}">Open Edgewarden security settings</a></p>`,
      tag: `emergency-access-${input.event}`,
    };
  }
  const actor = input.actorName?.trim() || input.actorEmail;
  const body = copy[input.event](actor);
  const settingsUrl = new URL("/vault/settings?tab=security", input.requestUrl);
  const safeBody = escapeEmailHtml(body);
  const safeUrl = escapeEmailHtml(settingsUrl.href);
  return {
    to: input.to,
    subject: subjects[input.event],
    text: `${body}\n\nOpen Edgewarden: ${settingsUrl.href}\n\nIf you did not expect this, contact the vault owner or your server administrator.`,
    html: `<p>${safeBody}</p><p><a href="${safeUrl}">Open Edgewarden security settings</a></p><p>If you did not expect this, contact the vault owner or your server administrator.</p>`,
    tag: `emergency-access-${input.event}`,
  };
}
