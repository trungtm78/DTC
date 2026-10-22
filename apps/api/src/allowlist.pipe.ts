import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { assertAllowedFields } from '@machvon/kernel';

/**
 * Per-route mass-assignment guard: `@Body(new AllowlistPipe<PatchBody>(['name'])) body`.
 * Only the request body is checked; other arguments pass through unchanged.
 */
export class AllowlistPipe<T extends object> implements PipeTransform {
  constructor(private readonly allowed: readonly (keyof T & string)[]) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type === 'body') assertAllowedFields<T>(value, this.allowed);
    return value;
  }
}
