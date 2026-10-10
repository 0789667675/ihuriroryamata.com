'use client';

import { useEffect, useRef, type ReactNode } from 'react';

type ModalProps = {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  dismissible?: boolean;
  onClose: () => void;
};

const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ ariaLabel, children, className = '', dismissible = true, onClose }: ModalProps) {
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusableElements = () => Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(focusableSelector) || []
    ).filter((element) => element.offsetParent !== null);

    const firstFocusable = focusableElements()[0];
    (firstFocusable || panelRef.current)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const elements = focusableElements();
      if (!elements.length) {
        event.preventDefault();
        panelRef.current?.focus();
      } else if (event.shiftKey && document.activeElement === elements[0]) {
        event.preventDefault();
        elements[elements.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === elements[elements.length - 1]) {
        event.preventDefault();
        elements[0].focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [dismissible]);

  return <div
    className="modal-backdrop"
    role="presentation"
    onMouseDown={(event) => {
      if (dismissible && event.target === event.currentTarget) onCloseRef.current();
    }}
  >
    <section
      ref={panelRef}
      className={`modal-panel ${className}`.trim()}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      tabIndex={-1}
    >
      {children}
    </section>
  </div>;
}