import 'reflect-metadata';
import { SetMetadata } from '@nestjs/common';
import type { INestApplicationContext, Type } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';

const OPERATION_ID_KEY = 'machvon:operation-id';

/** Ties a route handler to its `operationId` in openapi.json, so the isolation suite can see what is implemented. */
export const OperationId = (operationId: string): MethodDecorator => SetMetadata(OPERATION_ID_KEY, operationId);

/** The operationId declared with @OperationId on a route handler, if any. */
export function operationIdOf(handler: unknown): string | undefined {
  const id: unknown = typeof handler === 'function' ? Reflect.getMetadata(OPERATION_ID_KEY, handler) : undefined;
  return typeof id === 'string' ? id : undefined;
}

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

/** The operationIds of every controller registered in an initialized Nest application, in any module. */
export function implementedOperationIdsOf(app: INestApplicationContext): Set<string> {
  const controllers: Type[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      if (typeof wrapper.metatype === 'function') controllers.push(wrapper.metatype as Type);
    }
  }
  return implementedOperationIds(controllers);
}
