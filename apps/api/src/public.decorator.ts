import 'reflect-metadata';
import { SetMetadata } from '@nestjs/common';

export const PUBLIC_METADATA_KEY = 'machvon:public';

/** Marks a route that needs no permission (health checks, sign-in start). Every other route must carry an @OperationId. */
export const Public = (): MethodDecorator => SetMetadata(PUBLIC_METADATA_KEY, true);
