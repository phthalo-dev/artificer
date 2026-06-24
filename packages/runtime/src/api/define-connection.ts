import type { ArtificerConnection, ConnectionDefinition } from './types.js';

export function defineConnection(
  definition: ConnectionDefinition,
): ArtificerConnection {
  return {
    name: definition.name,
    definition,
  };
}
