import { style, t } from '../styles/system';

/** TextAreaField has no autosize; grow with content between ~2 and ~6 rows. */
export const composerField = style('message-composer-field', {
  '& textarea': {
    fieldSizing: 'content',
    minHeight: '3.5rem',
    maxHeight: '10rem',
  },
});

export const composerFooter = style('message-composer-footer', {
  marginTop: t.space.xs.var,
});
