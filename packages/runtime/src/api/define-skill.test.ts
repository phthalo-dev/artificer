import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { defineSkill } from './define-skill.js';

describe('defineSkill', () => {
  it('creates a skill with name, description, and content', () => {
    const skill = defineSkill({
      name: 'code-review',
      description: 'Code review checklist for the payments team',
      content: '## Checklist\n1. Check PCI compliance\n2. Use Money type',
    });

    assert.equal(skill.name, 'code-review');
    assert.equal(
      skill.description,
      'Code review checklist for the payments team',
    );
    assert.ok(skill.content.includes('PCI compliance'));
  });
});
