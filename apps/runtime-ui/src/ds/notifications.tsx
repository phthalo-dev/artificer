import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { styles } from 'typestyles';
import { color, font, space } from './tokens';

type Toast = {
  id: string;
  message: string;
  title?: string;
  color?: string;
  icon?: ReactNode;
  autoClose?: number | false;
};

type NotificationsApi = {
  show: (opts: { message: string; title?: string; color?: string; icon?: ReactNode; autoClose?: number | false }) => void;
};

let externalShow: NotificationsApi['show'] | null = null;

export const notifications: NotificationsApi = {
  show(opts) {
    externalShow?.(opts);
  },
};

let _id = 0;

const toastContainerCls = styles.class('nb-toast-container', {
  position: 'fixed',
  top: '16px',
  right: '16px',
  zIndex: 9999,
  display: 'flex',
  flexDirection: 'column',
  gap: space.sm,
  maxWidth: '380px',
});

const toastCls = styles.component('nb-toast', {
  base: {
    background: color.bg,
    border: `2px solid ${color.border}`,
    borderRadius: '0',
    boxShadow: `4px 4px 0 0 ${color.border}`,
    padding: space.md,
    fontFamily: font.familySans,
    fontSize: font.sizeSm,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    animation: 'nb-fadein 150ms ease',
    minWidth: '280px',
  },
  variants: {
    level: {
      success: { borderLeftColor: color.green,  borderLeftWidth: '4px' },
      error:   { borderLeftColor: color.red,    borderLeftWidth: '4px' },
      warning: { borderLeftColor: color.orange, borderLeftWidth: '4px' },
      info:    { borderLeftColor: color.blue,   borderLeftWidth: '4px' },
      default: {},
    },
  },
  defaultVariants: { level: 'default' },
});

function colorToLevel(c?: string): 'success' | 'error' | 'warning' | 'info' | 'default' {
  if (c === 'green' || c === 'teal') return 'success';
  if (c === 'red') return 'error';
  if (c === 'orange' || c === 'yellow') return 'warning';
  if (c === 'blue' || c === 'cyan' || c === 'indigo' || c === 'violet') return 'info';
  return 'default';
}

export function Notifications() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback<NotificationsApi['show']>((opts) => {
    const id = String(++_id);
    const toast: Toast = { id, autoClose: 4000, ...opts };
    setToasts((prev) => [...prev, toast]);
    if (toast.autoClose !== false) {
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), toast.autoClose as number);
    }
  }, []);

  useEffect(() => { externalShow = show; return () => { externalShow = null; }; }, [show]);

  return (
    <div className={toastContainerCls}>
      {toasts.map((t) => (
        <div key={t.id} className={toastCls({ level: colorToLevel(t.color) })}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
            <div>
              {t.title && <div style={{ fontWeight: 700, marginBottom: '2px' }}>{t.title}</div>}
              <div>{t.message}</div>
            </div>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '0 2px', color: color.dimmed }}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
