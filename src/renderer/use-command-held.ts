import { useEffect, useState } from 'react';

/** Long enough that a quick ⌘-shortcut never flashes the hints. */
const REVEAL_DELAY_MS = 400;

/**
 * True while ⌘ is held on its own past a short delay — the cue to show
 * shortcut hints. Pressing any other key means a shortcut is under way,
 * so the hints stay hidden until ⌘ is released and held again.
 */
export function useCommandHeld(): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const reset = (): void => {
      if (timer) clearTimeout(timer);
      timer = null;
      setHeld(false);
    };

    const handleKeyDown = (e: KeyboardEvent): void => {
      // ⌘ pressed while another modifier is already down starts a chord like ⌘⇧T
      if (e.key !== 'Meta' || e.shiftKey || e.altKey || e.ctrlKey) {
        reset();
        return;
      }
      if (timer || e.repeat) return;
      timer = setTimeout(() => setHeld(true), REVEAL_DELAY_MS);
    };

    const handleKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Meta') reset();
    };

    // Capture phase: the terminal must not be able to swallow these.
    // Blur covers ⌘-Tab, where the key-up lands in another app.
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', reset);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', reset);
    };
  }, []);

  return held;
}
