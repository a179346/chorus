import { useCallback, useRef, useState } from 'react';
import { ipcErrorMessage } from './ipc';

export interface AsyncSubmit<Args extends unknown[]> {
  /** Starts the action, unless it's already pending. Never rejects: a failure lands in `error`. */
  run: (...args: Args) => Promise<void>;
  /** From `run` until the action rejects; after success, until the owner closes (unmounts) the form. */
  pending: boolean;
  /** Why the last run failed; cleared by the next run. */
  error: string | null;
  /** For an edit that makes the error stale. */
  clearError: () => void;
}

/**
 * A dialog's async submit (create, save, delete). Success is the owner's to act
 * on by closing the dialog, so it stays pending until then and a second Enter
 * can't repeat the action; a rejection ends it and says why in `error`. While
 * it's pending the dialog shouldn't close either, so its result (closing, or an
 * error) can't land on a later one.
 */
export function useAsyncSubmit<Args extends unknown[]>(
  action: (...args: Args) => Promise<void>,
): AsyncSubmit<Args> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `pending` changes a render later; Enter and a click can both land before that
  const runningRef = useRef(false);

  const run = async (...args: Args): Promise<void> => {
    if (runningRef.current) return;
    runningRef.current = true;
    setPending(true);
    setError(null);
    try {
      await action(...args);
    } catch (err) {
      runningRef.current = false;
      setPending(false);
      setError(ipcErrorMessage(err));
    }
  };

  const clearError = useCallback(() => setError(null), []);

  return { run, pending, error, clearError };
}
