import { useEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])';

export interface NavigationDialogProps {
  /** Class of the overlay element, as the prototype names it (`module-directory`, `navigation-modal application-library`). */
  className: string;
  id?: string;
  onClose(): void;
  children: ReactNode;
}

/**
 * The overlay of the module directory and the application library: it moves focus inside on open, keeps Tab inside,
 * closes on Escape and on a press on the backdrop, and returns focus to what had it before. The panel inside carries
 * `role="dialog"`.
 */
export function NavigationDialog({ className, id, onClose, children }: NavigationDialogProps) {
  const overlay = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Element | null>(null);

  useEffect(() => {
    returnTo.current = document.activeElement;
    // The search field takes focus when there is one (as in the prototype), otherwise the first control.
    const start = overlay.current?.querySelector<HTMLElement>('input:not([disabled])') ?? overlay.current?.querySelector<HTMLElement>(FOCUSABLE);
    start?.focus();
    return () => {
      if (returnTo.current instanceof HTMLElement) returnTo.current.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...(overlay.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((item) => !item.hidden && !item.closest('[hidden]'));
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return createPortal(
    <div
      ref={overlay}
      id={id}
      className={className}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
