import type { TransactionalEmail } from "./email";
import { escapeEmailHtml } from "./email";

export function invitationEmail(input: {
  to: string;
  inviteLink: string;
  expiresAt: string;
}): TransactionalEmail {
  const safeLink = escapeEmailHtml(input.inviteLink);
  const safeExpiry = escapeEmailHtml(input.expiresAt);
  return {
    to: input.to,
    subject: "You are invited to Edgewarden",
    text: `An Edgewarden administrator invited this email address to create an account.\n\nAccept invitation: ${input.inviteLink}\n\nThis single-use invitation expires at ${input.expiresAt}. If you did not expect it, ignore this email.`,
    html: `<p>An Edgewarden administrator invited this email address to create an account.</p><p><a href="${safeLink}">Accept invitation</a></p><p>This single-use invitation expires at ${safeExpiry}. If you did not expect it, ignore this email.</p>`,
    tag: "account-invitation",
  };
}
