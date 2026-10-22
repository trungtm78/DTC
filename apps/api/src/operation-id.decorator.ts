import 'reflect-metadata';
import { SetMetadata } from '@nestjs/common';
import type { Type } from '@nestjs/common';

const OPERATION_ID_KEY = 'machvon:operation-id';

/** Ties a route handler to its `operationId` in openapi.json, so the isolation suite can see what is implemented. */
export const OperationId = (operationId: string): MethodDecorator => SetMetadata(OPERATION_ID_KEY, operationId);

/** The operationIds declared with @OperationId on the handlers of the given controllers. */
export function implementedOperationIds(controllers: readonly Type[]): Set<string> {
  const ids = new Set<string>();
  for (const controller of controllers) {
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const handler: unknown = Object.getOwnPropertyDescriptor(controller.prototype, name)?.value;
      if (typeof handler !== 'function') continue;
      const id: unknown = Reflect.getMetadata(OPERATION_ID_KEY, handler);
      if (typeof id === 'string') ids.add(id);
    }
  }
  return ids;
}
