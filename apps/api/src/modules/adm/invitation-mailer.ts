/** What the person invited receives: the one-time token and the link data, never stored by the server. */
export interface InvitationMessage {
  tenantId: string;
  invitationId: string;
  toEmail: string;
  token: string;
  expiresAt: Date;
}

/**
 * The port through which an invitation reaches the invited person. The email channel belongs to the OMNI module (R1);
 * until it exists, the MOCK adapter keeps the messages in memory so tests and the development stack can read the link.
 */
export interface InvitationMailer {
  send(message: InvitationMessage): Promise<void>;
}

export const INVITATION_MAILER = Symbol('INVITATION_MAILER');

/** In-memory adapter: it records what a real mailer would have sent. Never use it where invitations must be delivered. */
export class MockInvitationMailer implements InvitationMailer {
  readonly sent: InvitationMessage[] = [];

  send(message: InvitationMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  /** The newest message to an address, as a test or the development stack needs it. */
  lastTo(email: string): InvitationMessage | undefined {
    const wanted = email.trim().toLowerCase();
    return [...this.sent].reverse().find((message) => message.toEmail === wanted);
  }
}
