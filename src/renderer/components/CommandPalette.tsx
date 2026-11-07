import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { filterPaletteItems, type Matchable } from '../palette-match';
import { Keys } from './Kbd';

export interface PaletteItem extends Matchable {
  id: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  run: () => void;
}

interface CommandPaletteProps {
  items: PaletteItem[];
  onClose: () => void;
}

/**
 * ⌘K: type to filter sessions, actions, and toolkit commands; ↑↓ and ↵ to run.
 * Focus goes back where it was on close, unless the chosen action moved it.
 */
export function CommandPalette({ items, onClose }: CommandPaletteProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const paletteRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const results = useMemo(() => filterPaletteItems(items, query), [items, query]);
  // Session updates can shrink the list under the selection
  const selected = Math.min(selectedIndex, results.length - 1);

  useEffect(() => {
    const previous = document.activeElement;
    inputRef.current?.focus();

    // Another dialog taking focus (e.g. a menu shortcut fired) closes the palette
    const handleFocusIn = (e: FocusEvent): void => {
      if (e.target instanceof Node && !paletteRef.current?.contains(e.target)) onCloseRef.current();
    };
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      const focusWasLost = !document.activeElement || document.activeElement === document.body;
      if (focusWasLost && previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const choose = (item: PaletteItem): void => {
    onClose();
    item.run();
  };

  const move = (step: 1 | -1): void => {
    if (results.length === 0) return;
    setSelectedIndex((selected + step + results.length) % results.length);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) return;
    const ctrlOnly = e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === 'ArrowDown' || (ctrlOnly && e.key === 'n')) {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp' || (ctrlOnly && e.key === 'p')) {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = results[selected];
      if (item) choose(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const activeId = results[selected] ? `palette-item-${results[selected].id}` : undefined;

  return (
    <div
      className="palette-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={paletteRef} className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-search">
          <Search size={15} />
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Jump to a session or run a command…"
            spellCheck={false}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
          />
        </div>

        <div ref={listRef} id="palette-list" className="palette-list" role="listbox" aria-label="Results">
          {results.length === 0 ? (
            <div className="palette-empty">Nothing matches “{query.trim()}”</div>
          ) : (
            results.map((item, index) => (
              <React.Fragment key={item.id}>
                {(index === 0 || results[index - 1].group !== item.group) && (
                  <div className="palette-group" role="presentation">{item.group}</div>
                )}
                <div
                  id={`palette-item-${item.id}`}
                  role="option"
                  aria-selected={index === selected}
                  data-index={index}
                  className="palette-item"
                  // Keep focus in the input so ↵ and typing still work after a click
                  onMouseDown={(e) => e.preventDefault()}
                  // Move, not enter: a list scrolling under a still pointer mustn't steal the selection
                  onMouseMove={() => {
                    if (index !== selected) setSelectedIndex(index);
                  }}
                  onClick={() => choose(item)}
                >
                  <span className="palette-item-leading">{item.leading}</span>
                  <span className="palette-item-title">{item.title}</span>
                  <span className="palette-item-subtitle">{item.subtitle}</span>
                  {item.trailing && <span className="palette-item-trailing">{item.trailing}</span>}
                </div>
              </React.Fragment>
            ))
          )}
        </div>

        <div className="palette-footer" aria-hidden="true">
          <span><Keys keys={['↑', '↓']} /> navigate</span>
          <span><Keys keys={['↵']} /> select</span>
          <span><Keys keys={['esc']} /> close</span>
        </div>
      </div>
    </div>
  );
}
