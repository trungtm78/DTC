import { Logger } from '@nestjs/common';

/** Tells connected clients that a tenant's entitlements changed (the web refetches `getMyEntitlements`). Transports plug in behind it. */
export interface EntitlementPushPort {
  publish(tenantId: string, entitlementsHash: string): void;
}

export type EntitlementPushHandler = (tenantId: string, entitlementsHash: string) => void;

/** In-process delivery to subscribers (tests, single node); a server-sent-events or Redis transport replaces it later. */
export class InProcessEntitlementPush implements EntitlementPushPort {
  private readonly logger = new Logger(InProcessEntitlementPush.name);
  private readonly subscribers = new Set<EntitlementPushHandler>();

  /** Returns the function that removes the subscription. */
  subscribe(handler: EntitlementPushHandler): () => void {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  publish(tenantId: string, entitlementsHash: string): void {
    for (const handler of [...this.subscribers]) {
      try {
        handler(tenantId, entitlementsHash);
      } catch (error) {
        // One failing subscriber must not hide the change from the others.
        this.logger.error(error);
      }
    }
  }
}
