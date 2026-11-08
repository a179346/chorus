import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { filterPaletteItems, type Matchable } from '../palette-match';
import { useBackdropDismiss } from '../use-backdrop-dismiss';
import { useCloseOnFocusOutside } from '../use-close-on-focus-outside';
import { useFocusReturn } from '../use-focus-return';
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
  // By id, so the highlight stays on its item when session updates reorder the list
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const backdrop = useBackdropDismiss(onClose);

  const isReturningFocus = useFocusReturn(paletteRef);
  useCloseOnFocusOutside(paletteRef, isReturningFocus, onClose);

  const results = useMemo(() => filterPaletteItems(items, query), [items, query]);
  // No highlight yet, or its item dropped out of the list: the top result has it
  const selectedIndex = Math.max(0, results.findIndex((item) => item.id === selectedId));
  const selectedItem: PaletteItem | undefined = results[selectedIndex];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const choose = (item: PaletteItem): void => {
    onClose();
    item.run();
  };

  const search = (text: string): void => {
    setQuery(text);
    setSelectedId(null);
  };

  const move = (step: 1 | -1): void => {
    if (results.length === 0) return;
    setSelectedId(results[(selectedIndex + step + results.length) % results.length].id);
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
      if (selectedItem) choose(selectedItem);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      // The input is the palette's only stop; Tab would carry focus out to the page behind
      e.preventDefault();
    }
  };

  const activeId = selectedItem ? `palette-item-${selectedItem.id}` : undefined;

  return (
    <div className="palette-overlay" {...backdrop}>
      <div
        ref={paletteRef}
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        // A press anywhere but the input leaves focus in it, so typing and ↵ keep working
        onMouseDown={(e) => {
          if (e.target !== inputRef.current) e.preventDefault();
        }}
      >
        <div className="palette-search">
          <Search size={15} />
          <input
            ref={inputRef}
            className="palette-input"
            // Uncontrolled, so an IME's unfinished text stays in the field without being searched for
            onChange={(e) => {
              if (e.nativeEvent instanceof InputEvent && e.nativeEvent.isComposing) return;
              search(e.target.value);
            }}
            onCompositionEnd={(e) => search(e.currentTarget.value)}
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

        <div
          ref={listRef}
          id="palette-list"
          className="palette-list"
          role="listbox"
          aria-label="Results"
          // Chromium makes a scrolling box a Tab stop; the keys belong in the input
          tabIndex={-1}
        >
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
                  aria-selected={index === selectedIndex}
                  data-index={index}
                  className="palette-item"
                  // Move, not enter: a list scrolling under a still pointer mustn't steal the selection
                  onMouseMove={() => {
                    if (index !== selectedIndex) setSelectedId(item.id);
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
