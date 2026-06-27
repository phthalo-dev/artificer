import { type ReactNode, useCallback, useEffect, useState } from 'react';
import {
  toast as toastCls,
  toastContainer,
  toastDismiss,
  toastRow,
  toastTitle,
} from './notifications.styles';

type Toast = {
  id: string;
  message: string;
  title?: string;
  color?: string;
  icon?: ReactNode;
  autoClose?: number | false;
};

type NotificationsApi = {
  show: (opts: {
    message: string;
    title?: string;
    color?: string;
    icon?: ReactNode;
    autoClose?: number | false;
  }) => void;
};

let externalShow: NotificationsApi['show'] | null = null;

export const notifications: NotificationsApi = {
  show(opts) {
    externalShow?.(opts);
  },
};

let _id = 0;

function colorToLevel(
  c?: string,
): 'success' | 'error' | 'warning' | 'info' | 'default' {
  if (c === 'green' || c === 'teal') return 'success';
  if (c === 'red') return 'error';
  if (c === 'orange' || c === 'yellow') return 'warning';
  if (c === 'blue' || c === 'cyan' || c === 'indigo' || c === 'violet')
    return 'info';
  return 'default';
}

export function Notifications() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback<NotificationsApi['show']>((opts) => {
    const id = String(++_id);
    const toast: Toast = { id, autoClose: 4000, ...opts };
    setToasts((prev) => [...prev, toast]);
    if (toast.autoClose !== false) {
      setTimeout(
        () => setToasts((prev) => prev.filter((t) => t.id !== id)),
        toast.autoClose as number,
      );
    }
  }, []);

  useEffect(() => {
    externalShow = show;
    return () => {
      externalShow = null;
    };
  }, [show]);

  return (
    <div className={toastContainer}>
      {toasts.map((t) => (
        <div key={t.id} className={toastCls({ level: colorToLevel(t.color) })}>
          <div className={toastRow}>
            <div>
              {t.title && <div className={toastTitle}>{t.title}</div>}
              <div>{t.message}</div>
            </div>
            <button
              className={toastDismiss}
              onClick={() =>
                setToasts((prev) => prev.filter((x) => x.id !== t.id))
              }
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
