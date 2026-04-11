import React, { useCallback, useRef, useState, useEffect } from 'react';

interface SplitPaneProps {
  direction: 'horizontal' | 'vertical';
  initialSize: number;
  minPrimary: number;
  minSecondary: number;
  maxPrimaryRatio?: number;
  primaryIndex?: 0 | 1;
  onResize?: (size: number) => void;
  children: [React.ReactNode, React.ReactNode];
  collapsed?: boolean;
  collapsedSize?: number;
}

export function SplitPane({
  direction,
  initialSize,
  minPrimary,
  minSecondary,
  maxPrimaryRatio,
  primaryIndex = 0,
  onResize,
  children,
  collapsed = false,
  collapsedSize = 0,
}: SplitPaneProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(initialSize);
  const draggingRef = useRef(false);
  const startPosRef = useRef(0);
  const startSizeRef = useRef(0);

  // Keep callback ref stable to avoid re-registering mouse handlers
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  useEffect(() => {
    setSize(initialSize);
  }, [initialSize]);

  const isHorizontal = direction === 'horizontal';

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (collapsed) return;
      e.preventDefault();
      draggingRef.current = true;
      startPosRef.current = isHorizontal ? e.clientX : e.clientY;
      startSizeRef.current = size;
      document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';

      const handleMouseMove = (e: MouseEvent) => {
        if (!draggingRef.current || !containerRef.current) return;
        const containerRect = containerRef.current.getBoundingClientRect();
        const containerSize = isHorizontal ? containerRect.width : containerRect.height;
        const delta = (isHorizontal ? e.clientX : e.clientY) - startPosRef.current;
        const multiplier = primaryIndex === 0 ? 1 : -1;
        let newSize = startSizeRef.current + delta * multiplier;
        const maxPrimary = maxPrimaryRatio ? containerSize * maxPrimaryRatio : containerSize - minSecondary;
        newSize = Math.max(minPrimary, Math.min(Math.min(maxPrimary, containerSize - minSecondary), newSize));
        setSize(newSize);
        onResizeRef.current?.(newSize);
      };

      const handleMouseUp = () => {
        draggingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [isHorizontal, size, minPrimary, minSecondary, maxPrimaryRatio, primaryIndex, collapsed]
  );

  const effectiveSize = collapsed ? collapsedSize : size;

  const primaryStyle: React.CSSProperties = isHorizontal
    ? { width: effectiveSize, minWidth: collapsed ? collapsedSize : minPrimary, height: '100%' }
    : { height: effectiveSize, minHeight: collapsed ? collapsedSize : minPrimary, width: '100%' };

  const secondaryStyle: React.CSSProperties = {
    flex: 1,
    minWidth: isHorizontal ? minSecondary : undefined,
    minHeight: !isHorizontal ? minSecondary : undefined,
    overflow: 'hidden',
  };

  const dividerStyle: React.CSSProperties = {
    position: 'relative',
    flexShrink: 0,
    ...(isHorizontal
      ? { width: 'var(--divider-size)', cursor: collapsed ? 'default' : 'col-resize' }
      : { height: 'var(--divider-size)', cursor: collapsed ? 'default' : 'row-resize' }),
    background: 'rgba(var(--tint-rgb), 0.08)',
    zIndex: 2,
  };

  const dividerHitAreaStyle: React.CSSProperties = {
    position: 'absolute',
    ...(isHorizontal
      ? { top: 0, bottom: 0, left: '-3px', right: '-3px' }
      : { left: 0, right: 0, top: '-3px', bottom: '-3px' }),
    zIndex: 3,
  };

  // Children always render in order: children[0] first, children[1] second.
  // primaryIndex controls which child gets the fixed size (primaryStyle).
  const firstStyle = primaryIndex === 0 ? primaryStyle : secondaryStyle;
  const secondStyle = primaryIndex === 0 ? secondaryStyle : primaryStyle;

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: isHorizontal ? 'row' : 'column',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <div style={{ ...firstStyle, overflow: 'hidden' }}>{children[0]}</div>
      <div style={dividerStyle} onMouseDown={handleMouseDown}>
        <div style={dividerHitAreaStyle} />
      </div>
      <div style={{ ...secondStyle, overflow: 'hidden' }}>{children[1]}</div>
    </div>
  );
}
