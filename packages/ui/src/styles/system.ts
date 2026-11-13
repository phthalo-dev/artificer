import { createTypeStyles } from 'typestyles';

/**
 * App-owned TypeStyles instance. Var UI's own CSS lives in cascade layers, so
 * these unlayered classes win over component defaults without specificity hacks.
 */
export const { style, global, recipe } = createTypeStyles({
  scopeId: 'artificer',
});

export { designTokens as t, palette } from '@var-ui/core';
export { cx } from 'typestyles';
