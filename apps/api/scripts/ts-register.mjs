// Lets Node run the TypeScript sources of the workspace with Nest decorators: `node --import ./scripts/ts-register.mjs src/serve.ts`.
import { register } from 'node:module';

register('./ts-loader.mjs', import.meta.url);
