import type { ArtificerSkill, SkillDefinition } from './types.js';

export function defineSkill(definition: SkillDefinition): ArtificerSkill {
  return {
    name: definition.name,
    description: definition.description,
    content: definition.content,
  };
}
