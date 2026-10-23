import type { AlertSink } from '@machvon/kernel';
import type { Config } from '../config/config';

/** What an alert looks like on the wire: the code and the context the raiser gave, plus when and from where. */
export interface AlertPayload {
  code: string;
  context: Record<string, unknown>;
  at: string;
  service: string;
}

/** The port to the on-call channel (a chat webhook, a pager). Real adapters replace the MOCK one without touching a raiser. */
export interface AlertWebhookPort {
  send(payload: AlertPayload): Promise<void>;
}

/** Keeps what was sent; the MOCK adapter of the operations channel until a pager is chosen. */
export class MockAlertWebhook implements AlertWebhookPort {
  readonly sent: AlertPayload[] = [];
  async send(payload: AlertPayload): Promise<void> {
    this.sent.push(payload);
  }
}

/** POSTs the payload as JSON to the configured URL. */
export class FetchAlertWebhook implements AlertWebhookPort {
  constructor(
    private readonly url: string,
    private readonly send_: typeof fetch = fetch,
  ) {}

  async send(payload: AlertPayload): Promise<void> {
    const response = await this.send_(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`the alert webhook answered ${response.status}`);
  }
}

const SECRET_KEY = /(password|secret|token|authorization|api[_-]?key|private[_-]?key)/i;

/** The context without anything that looks like a credential: an alert goes to a channel many people read. */
export function safeContext(context: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(context).map(([key, value]) => [key, SECRET_KEY.test(key) ? '[redacted]' : value]));
}

export interface AlertSinkOptions {
  now?: () => Date;
  service?: string;
  /** Where the log adapter writes a line; defaults to standard error. */
  write?: (line: string) => void;
  /** The delivery adapter; defaults to the one the configuration names. */
  webhook?: AlertWebhookPort;
  fetch?: typeof fetch;
}

/**
 * The one AlertSink of the process (relay, seal job, consumers, jobs all raise through it): every alert is written as a
 * JSON line, and also delivered to the webhook when one is configured. A failing delivery never fails the raiser; it is
 * written to the log instead, so the alert is not lost.
 */
export function createAlertSink(config: Pick<Config, 'alertWebhookUrl' | 'telemetry'>, options: AlertSinkOptions = {}): AlertSink {
  const now = options.now ?? (() => new Date());
  const write = options.write ?? ((line: string) => void process.stderr.write(`${line}\n`));
  const service = options.service ?? config.telemetry.serviceName;
  const webhook = options.webhook ?? (config.alertWebhookUrl === undefined ? undefined : new FetchAlertWebhook(config.alertWebhookUrl, options.fetch));
  return {
    raise(code, context) {
      const payload: AlertPayload = { code, context: safeContext(context), at: now().toISOString(), service };
      write(JSON.stringify({ level: 'alert', ...payload }));
      if (webhook === undefined) return;
      webhook.send(payload).catch(() => write(JSON.stringify({ level: 'error', message: 'alert delivery failed', code })));
    },
  };
}
