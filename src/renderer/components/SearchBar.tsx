import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import { terminals, type TerminalKind } from '../terminal-host';
import { on, IpcChannels } from '../ipc';

let activeSearchType: TerminalKind | null = null;

interface SearchBarProps {
  type: TerminalKind;
  sessionId: string;
  onClose: () => void;
}

export function SearchBar({ type, sessionId, onClose }: SearchBarProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [resultIndex, setResultIndex] = useState(-1);
  const [resultCount, setResultCount] = useState(0);

  useEffect(() => {
    activeSearchType = type;
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => { if (activeSearchType === type) activeSearchType = null; };
  }, [type]);

  // The bar also unmounts when the active session changes, so highlights are cleared here, not only on Close.
  useEffect(() => () => terminals.clearSearch(type, sessionId), [type, sessionId]);

  useEffect(() => {
    if (query) {
      const result = terminals.findNext(type, sessionId, query);
      setResultIndex(result.resultIndex);
      setResultCount(result.resultCount);
    } else {
      terminals.clearSearch(type, sessionId);
      setResultIndex(-1);
      setResultCount(0);
    }
  }, [query, type, sessionId]);

  const queryRef = useRef(query);
  queryRef.current = query;

  const handleNext = useCallback(() => {
    if (queryRef.current) {
      const result = terminals.findNext(type, sessionId, queryRef.current);
      setResultIndex(result.resultIndex);
      setResultCount(result.resultCount);
    }
  }, [type, sessionId]);

  const handlePrev = useCallback(() => {
    if (queryRef.current) {
      const result = terminals.findPrevious(type, sessionId, queryRef.current);
      setResultIndex(result.resultIndex);
      setResultCount(result.resultCount);
    }
  }, [type, sessionId]);

  useEffect(() => {
    const isOwner = () => {
      const focused = terminals.focused();
      return focused ? focused.kind === type : activeSearchType === type;
    };
    const guardedNext = () => { if (isOwner()) handleNext(); };
    const guardedPrev = () => { if (isOwner()) handlePrev(); };
    const cleanups = [
      on(IpcChannels.MENU_FIND_NEXT, guardedNext),
      on(IpcChannels.MENU_FIND_PREVIOUS, guardedPrev),
    ];
    return () => cleanups.forEach((c) => c());
  }, [handleNext, handlePrev, type]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        handlePrev();
      } else {
        handleNext();
      }
    }
  }, [onClose, handleNext, handlePrev]);

  const resultText = query
    ? resultCount > 0
      ? `${resultIndex + 1} of ${resultCount}`
      : 'No results'
    : '';

  return (
    <div style={containerStyle}>
      <div style={barStyle}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { activeSearchType = type; }}
          onKeyDown={handleKeyDown}
          placeholder="Find"
          aria-label="Find in terminal"
          className="input"
          style={inputStyle}
        />
        {resultText && (
          <span style={resultTextStyle}>{resultText}</span>
        )}
        <button type="button" className="icon-btn" onClick={handlePrev} title="Previous (⇧↵)" aria-label="Previous match">
          <ChevronUp size={14} />
        </button>
        <button type="button" className="icon-btn" onClick={handleNext} title="Next (↵)" aria-label="Next match">
          <ChevronDown size={14} />
        </button>
        <button type="button" className="icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close find">
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 16,
  zIndex: 100,
  animation: 'slideDown 140ms var(--ease-out)',
};

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-md)',
  padding: '4px 6px',
};

const inputStyle: React.CSSProperties = {
  width: 180,
  padding: '3px 8px',
  fontFamily: 'var(--font-ui)',
};

const resultTextStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-secondary)',
  fontFamily: 'var(--font-ui)',
  whiteSpace: 'nowrap',
  minWidth: 60,
  textAlign: 'center',
};
