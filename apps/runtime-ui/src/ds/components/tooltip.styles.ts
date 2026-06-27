import { styles } from '../styles';
import { color, font, space } from '../tokens';

export const tooltip = styles.class('tooltip', {
  background: color.border,
  color: color.bg,
  fontFamily: font.familySans,
  fontSize: font.sizeXs,
  fontWeight: font.w600,
  padding: `${space.xs} ${space.sm}`,
  borderRadius: '0',
  maxWidth: '280px',
  zIndex: 1001,
  animation: 'fadein 100ms ease',
});
