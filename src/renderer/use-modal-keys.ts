import { useEffect } from 'react';

/** Escape closes the dialog and Tab cycles focus inside it. */
export function useModalKeys(dialogRef: React.RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Keys typed into an IME belong to it: Escape there cancels the composition, not the dialog
      if (e.isComposing) return;
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          // A disabled control can't take focus, so it must not count as first/last
          'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dialogRef, onClose]);
}
