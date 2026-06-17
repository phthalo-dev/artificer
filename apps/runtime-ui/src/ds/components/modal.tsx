import { type ReactNode } from 'react';
import {
  Dialog as AriaDialog,
  Heading,
  Modal as AriaModal,
  ModalOverlay,
} from 'react-aria-components';
import { styles } from 'typestyles';
import { color, font, space } from '../tokens';

const modalCls = {
  overlay: styles.class('nb-modal-overlay', {
    position: 'fixed',
    inset: '0',
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: space.md,
  }),
  modal: styles.class('nb-modal', {
    background: color.bg,
    border: `2px solid ${color.border}`,
    borderRadius: '0',
    boxShadow: `6px 6px 0 0 ${color.border}`,
    width: '100%',
    outline: 'none',
    animation: 'nb-fadein 150ms ease',
  }),
  content: styles.class('nb-modal-content', { padding: space.lg }),
  header: styles.class('nb-modal-header', {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${space.md} ${space.lg}`,
    borderBottom: `2px solid ${color.border}`,
  }),
  title: styles.class('nb-modal-title', { fontSize: font.sizeLg, fontWeight: font.w700 }),
  closeBtn: styles.class('nb-modal-close', {
    background: 'none',
    border: `2px solid ${color.border}`,
    padding: '2px 8px',
    cursor: 'pointer',
    fontFamily: font.familySans,
    fontSize: font.sizeLg,
    lineHeight: '1',
    '&:hover': { background: color.grayLight },
  }),
};

const SIZE_MAP: Record<string, string> = {
  xs: '360px', sm: '480px', md: '600px', lg: '800px', xl: '1000px',
};

export type ModalProps = {
  opened: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
};

export function Modal({ opened, onClose, title, children, size = 'md' }: ModalProps) {
  return (
    <ModalOverlay
      isOpen={opened}
      onOpenChange={(open) => { if (!open) onClose(); }}
      className={modalCls.overlay}
    >
      <AriaModal className={modalCls.modal} style={{ maxWidth: SIZE_MAP[size] }}>
        <AriaDialog>
          {({ close }) => (
            <>
              <div className={modalCls.header}>
                <Heading slot="title" className={modalCls.title}>{title}</Heading>
                <button className={modalCls.closeBtn} onClick={close} aria-label="Close">×</button>
              </div>
              <div className={modalCls.content}>{children}</div>
            </>
          )}
        </AriaDialog>
      </AriaModal>
    </ModalOverlay>
  );
}
