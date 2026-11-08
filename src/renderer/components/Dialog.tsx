import React, { useEffect, useRef, useState } from 'react';
import { ipcErrorMessage } from '../ipc';
import { useBackdropDismiss } from '../use-backdrop-dismiss';
import { useFocusReturn } from '../use-focus-return';
import { useModalKeys } from '../use-modal-keys';

interface DialogProps {
  title: React.ReactNode;
  /** Accessible name; `title` may hold markup. */
  label: string;
  onClose: () => void;
  width?: number;
  role?: 'dialog' | 'alertdialog';
  children: React.ReactNode;
}

/**
 * Modal shell: dimmed backdrop, Escape to close, Tab trapped inside, and focus
 * handed back on close. The backdrop closes the dialog only when a click both
 * starts and ends on it, so a text selection dragged out of a field doesn't
 * throw the form away.
 */
export function Dialog({ title, label, onClose, width = 420, role = 'dialog', children }: DialogProps): React.ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdrop = useBackdropDismiss(onClose);

  useModalKeys(dialogRef, onClose);
  useFocusReturn(dialogRef);

  return (
    <div className="dialog-overlay" {...backdrop}>
      <div ref={dialogRef} className="dialog" style={{ width }} role={role} aria-modal="true" aria-label={label}>
        <div className="dialog-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  /** May be async: while it runs a second confirm is ignored, and if it rejects the dialog stays open and says why. */
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/** A destructive yes/no question; the confirm button takes focus so Enter answers it. */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps): React.ReactElement {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Enter and a click can both land before an async confirm settles
  const confirmingRef = useRef(false);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  const confirm = async () => {
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      confirmingRef.current = false;
    }
  };

  return (
    <Dialog title={title} label={title} onClose={onCancel} width={380} role="alertdialog">
      <p className="dialog-text">{message}</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button ref={confirmRef} type="button" className="btn btn-danger" onClick={() => void confirm()}>{confirmLabel}</button>
      </div>
    </Dialog>
  );
}
