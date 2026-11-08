import { createContext, useContext, useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Where focus goes when a closing menu, dialog, or palette has nothing to
 * hand it back to. App points it at the active session's Claude terminal.
 */
export const FocusFallbackContext = createContext<() => void>(() => {});

/**
 * On unmount, hands focus back to whatever had it when the component mounted,
 * unless focus has meanwhile moved outside the container (the chosen action
 * took it somewhere on purpose). When that element can no longer take focus,
 * or none was known, the FocusFallbackContext gets it instead.
 */
export function useFocusReturn(containerRef: RefObject<HTMLElement | null>): void {
  const fallback = useContext(FocusFallbackContext);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  // Layout phase: after a menu or palette closing in the same update has
  // handed focus back to its own opener, and before content focuses itself
  // in an effect. The cleanup runs while the container is still in the page.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const opener = openerOf(container);
    return () => {
      if (!focusIsLeavingWith(container)) return;
      if (opener && focusOn(opener)) return;
      fallbackRef.current();
    };
  }, [containerRef]);
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
  const active = document.activeElement;
  return !active || active === document.body || container.contains(active);
}

/** Focuses `element` if it still can (attached, visible, enabled); says whether it did. */
function focusOn(element: HTMLElement): boolean {
  element.focus();
  return document.activeElement === element;
}
