import type { CommandScope } from './command-scope';

/** The CommandResult of openapi.json: what every successful command answers. */
export interface CommandResult {
  operation_id: string;
  status: string;
  resource_version: number;
  resource_id: string;
}

export function commandResult(scope: CommandScope, status: string, version: number, resourceId: string): CommandResult {
  return { operation_id: scope.requestId, status, resource_version: version, resource_id: resourceId };
}
