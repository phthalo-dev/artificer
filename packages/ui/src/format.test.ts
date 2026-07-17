import { describe, expect, it } from 'vitest';
import { formatCost, formatDuration, formatTokensShort } from './format';

describe('formatCost', () => {
  it('formats zero and small amounts', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(0.0042)).toBe('$0.0042');
    expect(formatCost(1.5)).toBe('$1.50');
  });
});

describe('formatDuration', () => {
  it('uses s/m/h units', () => {
    expect(formatDuration(42_000)).toBe('42s');
    expect(formatDuration(834_000)).toBe('13.9m');
    expect(formatDuration(4_320_000)).toBe('1.2h');
  });
});

describe('formatTokensShort', () => {
  it('abbreviates thousands and millions', () => {
    expect(formatTokensShort(812)).toBe('812');
    expect(formatTokensShort(47_000)).toBe('47k');
    expect(formatTokensShort(1_200_000)).toBe('1.2M');
  });
});
