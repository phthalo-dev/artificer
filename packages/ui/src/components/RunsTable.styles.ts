import { style } from '../styles/system';

/** Var UI's Table root already scrolls horizontally; give the table a floor width. */
export const runsTable = style('runs-table', {
  '& table': { minWidth: '680px' },
});
