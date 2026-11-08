import { useRef, type MouseEventHandler } from 'react';

interface BackdropHandlers {
  onMouseDown: MouseEventHandler<HTMLElement>;
  onMouseUp: MouseEventHandler<HTMLElement>;
}

/**
 * Mouse handlers for a modal's backdrop. It dismisses only when a click both
 * starts and ends on the backdrop itself, so a drag across its edge (a text
 * selection overshooting a field, say) never throws the modal away. Pressing
 * the backdrop leaves focus in the modal, so it can go back where it came
 * from on close.
 */
export function useBackdropDismiss(onDismiss: () => void): BackdropHandlers {
  const pressedOnBackdrop = useRef(false);
  return {
    onMouseDown: (e) => {
      const onBackdrop = e.target === e.currentTarget;
      if (onBackdrop) e.preventDefault();
      pressedOnBackdrop.current = onBackdrop && e.button === 0;
    },
    onMouseUp: (e) => {
      const releasedOnBackdrop = e.target === e.currentTarget;
      if (pressedOnBackdrop.current && releasedOnBackdrop) onDismiss();
      pressedOnBackdrop.current = false;
    },
  };
}
