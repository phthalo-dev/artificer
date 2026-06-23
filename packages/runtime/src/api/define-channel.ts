import type { ArtificerChannel, ChannelDefinition } from './types.js';

export function defineChannel(definition: ChannelDefinition): ArtificerChannel {
  return {
    name: definition.name,
    definition,
    receive: (payload) => Promise.resolve(definition.receive(payload)),
    format: (output) => Promise.resolve(definition.format(output)),
  };
}
