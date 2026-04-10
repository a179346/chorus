import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  terminalFindNext,
  terminalFindPrevious,
  terminalClearSearch,
} from './TerminalView';

interface SearchBarProps {
  type: 'pty' | 'shell';
  sessionId: string;
  onClose: () => void;
}

export function SearchBar({ type, sessionId, onClose }: SearchBarProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [resultIndex, setResultIndex] = useState(-1);
  const [resultCount, setResultCount] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    if (query) {
      const result = terminalFindNext(type, sessionId, query);
      setResultIndex(result.resultIndex);
      setResultCount(result.resultCount);
    } else {
      terminalClearSearch(type, sessionId);
      setResultIndex(-1);
      setResultCount(0);
    }
  }, [query, type, sessionId]);

  const queryRef = useRef(query);
  queryRef.current = query;

  const handleNext = useCallback(() => {
    if (queryRef.current) {
      const result = terminalFindNext(type, sessionId, queryRef.current);
      setResultIndex(result.resultIndex);
      setResultCount(result.resultCount);
    }
  }, [type, sessionId]);

  const handlePrev = useCallback(() => {
    if (queryRef.current) {
      const result = terminalFindPrevious(type, sessionId, queryRef.current);
      setResultIndex(result.resultIndex);
      setResultCount(result.resultCount);
    }
  }, [type, sessionId]);

  useEffect(() => {
    const cleanups = [
      window.electronAPI.onMenuFindNext(handleNext),
      window.electronAPI.onMenuFindPrevious(handlePrev),
    ];
    return () => cleanups.forEach((c) => c());
  }, [handleNext, handlePrev]);

  const handleClose = useCallback(() => {
    terminalClearSearch(type, sessionId);
    onClose();
  }, [type, sessionId, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        handlePrev();
      } else {
        handleNext();
      }
    }
  }, [handleClose, handleNext, handlePrev]);

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
          onKeyDown={handleKeyDown}
          placeholder="Search..."
          style={inputStyle}
        />
        {resultText && (
          <span style={resultTextStyle}>{resultText}</span>
        )}
        <button onClick={handlePrev} style={btnStyle} title="Previous (Shift+Enter)">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 7.5L6 4L9.5 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button onClick={handleNext} style={btnStyle} title="Next (Enter)">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button onClick={handleClose} style={btnStyle} title="Close (Escape)">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(var(--status-bar-height) + 8px)',
  right: 16,
  zIndex: 100,
  animation: 'slideDown 120ms ease',
};

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-md)',
  padding: '4px 6px',
};

const inputStyle: React.CSSProperties = {
  width: 180,
  padding: '4px 8px',
  fontSize: 12,
  fontFamily: 'var(--font-ui)',
  color: 'var(--text-primary)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
};

const resultTextStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-secondary)',
  fontFamily: 'var(--font-ui)',
  whiteSpace: 'nowrap',
  minWidth: 60,
  textAlign: 'center',
};

const btnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-secondary)',
  transition: 'all var(--transition-fast)',
  flexShrink: 0,
};
