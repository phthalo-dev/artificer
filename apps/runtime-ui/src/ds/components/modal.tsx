import { type ReactNode } from 'react';
import {
  Dialog as AriaDialog,
  Heading,
  Modal as AriaModal,
  ModalOverlay,
} from 'react-aria-components';
import { modal } from './modal.styles';

export type ModalProps = {
  opened: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
};

export function Modal({
  opened,
  onClose,
  title,
  children,
  size = 'md',
}: ModalProps) {
  return (
    <ModalOverlay
      isOpen={opened}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className={modal.overlay}
    >
      <AriaModal className={modal.dialog({ size })}>
        <AriaDialog>
          {({ close }) => (
            <>
              <div className={modal.header}>
                <Heading slot="title" className={modal.title}>
                  {title}
                </Heading>
                <button
                  className={modal.closeBtn}
                  onClick={close}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div className={modal.content}>{children}</div>
            </>
          )}
        </AriaDialog>
      </AriaModal>
    </ModalOverlay>
  );
}
