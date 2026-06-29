import { styles } from '../styles';
import { color } from '../tokens';

export const loader = styles.component('loader', {
  base: {
    display: 'inline-block',
    width: '20px',
    height: '20px',
    border: `3px solid ${color.grayBg}`,
    borderTopColor: color.border,
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
  },
  variants: {
    size: {
      xs: { width: '12px', height: '12px', borderWidth: '2px' },
      sm: { width: '16px', height: '16px', borderWidth: '2px' },
      md: { width: '20px', height: '20px' },
      lg: { width: '28px', height: '28px', borderWidth: '4px' },
    },
  },
  defaultVariants: { size: 'md' },
});
