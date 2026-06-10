import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  modelFamilyFromId,
  modelFamilyPromptExtension,
  modelFamilyPromptForModel,
} from './model-family-prompts.js';

test('modelFamilyFromId maps known packages', () => {
  assert.equal(modelFamilyFromId('gpt-5.4-mini'), 'openai');
  assert.equal(modelFamilyFromId('claude-sonnet-4-6'), 'anthropic');
  assert.equal(modelFamilyFromId('gemini-3.1-pro'), 'google');
});

test('modelFamilyPromptExtension returns family-specific guidance', () => {
  assert.match(modelFamilyPromptExtension('openai'), /GPT/);
  assert.match(modelFamilyPromptExtension('google'), /Gemini/);
  assert.match(modelFamilyPromptExtension('anthropic'), /Claude/);
  assert.equal(modelFamilyPromptExtension('other'), '');
});

test('modelFamilyPromptForModel resolves from model id', () => {
  const ext = modelFamilyPromptForModel('gemini-3.1-pro');
  assert.match(ext, /absolute paths/i);
});
