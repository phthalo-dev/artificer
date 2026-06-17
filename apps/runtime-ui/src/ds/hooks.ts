import { useCallback, useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delay: number): [T] {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return [debounced];
}

export function useDisclosure(initial = false): [boolean, { open: () => void; close: () => void; toggle: () => void }] {
  const [opened, setOpened] = useState(initial);
  const open   = useCallback(() => setOpened(true),  []);
  const close  = useCallback(() => setOpened(false), []);
  const toggle = useCallback(() => setOpened((o) => !o), []);
  return [opened, { open, close, toggle }];
}
