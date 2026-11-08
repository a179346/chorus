import { useEffect, useRef, type RefObject } from 'react';

/**
 * Closes a menu or palette when focus moves to anything outside it: a dialog
 * opening over it, or an action focusing a terminal. Focus going back where it
 * came from as it closes doesn't count (`isReturningFocus`, from useFocusReturn).
 */
export function useCloseOnFocusOutside(
  containerRef: RefObject<HTMLElement | null>,
  isReturningFocus: () => boolean,
  onClose: () => void,
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleFocusIn = (e: FocusEvent): void => {
      if (isReturningFocus()) return;
      if (e.target instanceof Node && !container.contains(e.target)) onCloseRef.current();
    };
    document.addEventListener('focusin', handleFocusIn);
    return () => document.removeEventListener('focusin', handleFocusIn);
  }, [containerRef, isReturningFocus]);
}
