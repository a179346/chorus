import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Where focus goes when a closing menu, dialog, or palette has nothing to
 * hand it back to. App points it at the active session's Claude terminal, if
 * nothing else has taken focus a frame later.
 */
export const FocusFallbackContext = createContext<() => void>(() => {});

/**
 * On unmount, hands focus back to whatever had it when the component mounted,
 * unless focus has meanwhile moved outside the container (the chosen action
 * took it somewhere on purpose). When that element can no longer take focus,
 * none was known, or the same update removes it right after, the
 * FocusFallbackContext gets it instead.
 *
 * Returns a check for whether the component is unmounting, and so handing
 * focus back: one that closes when focus leaves it must not count those moves.
 */
export function useFocusReturn(containerRef: RefObject<HTMLElement | null>): () => boolean {
  const fallback = useContext(FocusFallbackContext);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  const returningFocus = useRef(false);
  const handedBackTo = useRef<HTMLElement | null>(null);

  // Layout phase: after a menu or palette closing in the same update has
  // handed focus back to its own opener, and before content focuses itself
  // in an effect. The cleanup runs while the container is still in the page.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Reset for StrictMode, which unmounts and remounts the same instance
    returningFocus.current = false;
    const opener = openerOf(container);
    return () => {
      returningFocus.current = true;
      if (!focusIsLeavingWith(container)) return;
      if (opener && focusOn(opener)) handedBackTo.current = opener;
      else fallbackRef.current();
    };
  }, [containerRef]);

  // Runs once the whole update is in the page, which may have removed the
  // opener right after focus went back to it ("Hide Shell Panel" chosen
  // while the shell had focus)
  useEffect(() => {
    return () => {
      const target = handedBackTo.current;
      handedBackTo.current = null;
      if (target && focusIsLost()) fallbackRef.current();
    };
  }, []);

  return useCallback(() => returningFocus.current, []);
}

/** Nothing has focus: it fell to the body, e.g. because the focused element was removed. */
export function focusIsLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body;
}

/** What had focus before `container` opened, if something outside it did. */
function openerOf(container: HTMLElement): HTMLElement | null {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || focused === document.body) return null;
  // Already inside means a child autofocused, so the opener is unknown
  return container.contains(focused) ? null : focused;
}

/** Focus is in `container`, about to vanish with it, or already lost. */
function focusIsLeavingWith(container: HTMLElement): boolean {
  return focusIsLost() || container.contains(document.activeElement);
}

/** Focuses `element` if it still can (attached, visible, enabled); says whether it did. */
function focusOn(element: HTMLElement): boolean {
  element.focus();
  return document.activeElement === element;
}
