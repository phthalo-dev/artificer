import { IconMoon, IconSun } from '@tabler/icons-react';
import { Button } from './button';
import { useTheme } from '../hooks';

export function ThemeToggle() {
  const { isDark, toggle } = useTheme();

  return (
    <Button
      variant="subtle"
      size="sm"
      onPress={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
    </Button>
  );
}
