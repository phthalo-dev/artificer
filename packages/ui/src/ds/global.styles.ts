import { keyframes } from 'typestyles';
import { global } from './styles';
import { color } from './tokens';

keyframes.create('spin', {
  to: { transform: 'rotate(360deg)' },
});

keyframes.create('fadein', {
  from: { opacity: 0, transform: 'translateY(-6px)' },
  to: { opacity: 1, transform: 'translateY(0)' },
});

global.style('*, *::before, *::after', {
  boxSizing: 'border-box',
  margin: 0,
  padding: 0,
});

global.style('html, body, #root', {
  height: '100%',
});

global.style('body', {
  fontFamily:
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontSize: '14px',
  lineHeight: 1.5,
  color: color.text,
  backgroundColor: color.bg,
  WebkitFontSmoothing: 'antialiased',
  MozOsxFontSmoothing: 'grayscale',
});

global.style(':focus-visible', {
  outline: `2px solid ${color.border}`,
  outlineOffset: '2px',
});

global.style('a', {
  color: 'inherit',
});

global.style('::-webkit-scrollbar', {
  width: '8px',
  height: '8px',
});

global.style('::-webkit-scrollbar-track', {
  background: 'transparent',
});

global.style('::-webkit-scrollbar-thumb', {
  background: color.border,
});
