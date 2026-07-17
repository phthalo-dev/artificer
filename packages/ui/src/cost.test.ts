import { describe, expect, it } from 'vitest';
import { costForUsage } from './cost';

describe('costForUsage', () => {
  it('prices sonnet-tier usage', () => {
    const cost = costForUsage('claude-sonnet-4', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      requests: 1,
    });
    // sonnet inputPerMTok = 3
    expect(cost).toBe(3);
  });

  it('falls back to sonnet pricing for unknown models', () => {
    const cost = costForUsage('unknown-model', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      requests: 1,
    });
    expect(cost).toBe(3);
  });
});
