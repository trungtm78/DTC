// Runs one scheduled database job once: npm run jobs:run -- <audit-seal|audit-verify|idempotency-purge>
import { main } from '../packages/db/src/jobs-cli.ts';

process.exitCode = await main(process.argv.slice(2));
