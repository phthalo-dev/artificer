import { styles } from '../styles';
import { color, font, space } from '../tokens';

export const inputBase = styles.class('input-base', {
  fontFamily: font.familySans,
  fontSize: font.sizeMd,
  color: color.text,
  background: color.bg,
  border: `1px solid ${color.border}`,
  borderRadius: '0',
  padding: `${space.xs} ${space.sm}`,
  width: '100%',
  outline: 'none',
  '&:focus': {
    outline: `2px solid ${color.border}`,
    outlineOffset: '2px',
  },
  '&::placeholder': { color: color.dimmed },
});

export const textarea = styles.class('textarea', {
  fontFamily: font.familySans,
  fontSize: font.sizeMd,
  color: color.text,
  background: color.bg,
  border: `1px solid ${color.border}`,
  borderRadius: '0',
  padding: space.sm,
  width: '100%',
  outline: 'none',
  resize: 'vertical',
  '&:focus': {
    outline: `2px solid ${color.border}`,
    outlineOffset: '2px',
  },
  '&::placeholder': { color: color.dimmed },
});

export const fieldRoot = styles.class('field-root', {
  position: 'relative',
});

export const fieldLabel = styles.class('field-label', {
  display: 'block',
  fontSize: font.sizeSm,
  fontWeight: 600,
  marginBottom: '4px',
});

export const fieldWrapper = styles.class('field-wrapper', {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
});

export const fieldLeftSection = styles.class('field-left-section', {
  position: 'absolute',
  left: '8px',
  color: color.dimmed,
  display: 'flex',
  pointerEvents: 'none',
});

export const inputWithLeftSection = styles.class('input-left-pad', {
  paddingLeft: '30px',
});
