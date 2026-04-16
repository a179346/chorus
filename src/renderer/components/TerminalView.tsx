import React, { useRef, useEffect, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { getTheme, DEFAULT_THEME_ID } from '../themes';
import type { XtermColors, SearchDecorations } from '../themes';

const DEFAULT_FONT_FAMILY = "'MesloLGS NF', 'JetBrains Mono', 'IBM Plex Mono', 'SF Mono', 'Fira Code', monospace";

interface TerminalViewProps {
  sessionId: string | null;
  type: 'pty' | 'shell';
  visible?: boolean;
  fontFamily?: string;
}

interface SearchResult {
  resultIndex: number;
  resultCount: number;
}

interface TerminalEntry {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  searchResult: SearchResult;
  mountedIn: HTMLElement | null;
  opened: boolean;
  removeDataListener: (() => void) | null;
}

const terminalCache = new Map<string, TerminalEntry>();

function getTerminalKey(type: string, sessionId: string): string {
  return `${type}:${sessionId}`;
}

// ─── Dynamic Theme State ───────────────────────────────────

let currentXtermTheme: XtermColors = getTheme(DEFAULT_THEME_ID).xtermTheme;
let currentSearchDecorations: SearchDecorations = getTheme(DEFAULT_THEME_ID).searchDecorations;

/** Update the xterm theme on all cached terminal instances. */
export function setTerminalTheme(xtermTheme: XtermColors, searchDecorations: SearchDecorations): void {
  currentXtermTheme = xtermTheme;
  currentSearchDecorations = searchDecorations;
  for (const entry of terminalCache.values()) {
    entry.terminal.options.theme = xtermTheme;
  }
}

// ─── Public API ────────────────────────────────────────────

/** Focus a cached terminal instance. */
export function focusTerminal(type: 'pty' | 'shell', sessionId: string): void {
  const key = getTerminalKey(type, sessionId);
  const entry = terminalCache.get(key);
  if (entry) {
    entry.terminal.focus();
  }
}

/** Dispose and remove a terminal from the cache. */
export function disposeTerminal(type: 'pty' | 'shell', sessionId: string): void {
  const key = getTerminalKey(type, sessionId);
  const entry = terminalCache.get(key);
  if (entry) {
    entry.removeDataListener?.();
    entry.terminal.dispose();
    terminalCache.delete(key);
  }
}

// ─── Focus Tracking ─────────────────────────────────────

let focusedTerminalKey: string | null = null;

export function getFocusedTerminalInfo(): { type: 'pty' | 'shell'; sessionId: string } | null {
  if (!focusedTerminalKey) return null;
  const [type, ...rest] = focusedTerminalKey.split(':');
  const sessionId = rest.join(':');
  return { type: type as 'pty' | 'shell', sessionId };
}

// ─── Search Functions ───────────────────────────────────

export function terminalFindNext(type: 'pty' | 'shell', sessionId: string, term: string): SearchResult {
  const key = getTerminalKey(type, sessionId);
  const entry = terminalCache.get(key);
  if (!entry) return { resultIndex: -1, resultCount: 0 };
  entry.searchAddon.findNext(term, { decorations: currentSearchDecorations });
  return { ...entry.searchResult };
}

export function terminalFindPrevious(type: 'pty' | 'shell', sessionId: string, term: string): SearchResult {
  const key = getTerminalKey(type, sessionId);
  const entry = terminalCache.get(key);
  if (!entry) return { resultIndex: -1, resultCount: 0 };
  entry.searchAddon.findPrevious(term, { decorations: currentSearchDecorations });
  return { ...entry.searchResult };
}

export function terminalClearSearch(type: 'pty' | 'shell', sessionId: string): void {
  const key = getTerminalKey(type, sessionId);
  const entry = terminalCache.get(key);
  if (entry) entry.searchAddon.clearDecorations();
}

/** Update font family on all cached terminal instances. */
export function setAllTerminalsFontFamily(fontFamily: string): void {
  for (const entry of terminalCache.values()) {
    entry.terminal.options.fontFamily = fontFamily;
    try { entry.fitAddon.fit(); } catch { /* not mounted */ }
  }
}

function safeFitAndResize(
  fitAddon: FitAddon,
  terminal: Terminal,
  sessionId: string,
  resizeMethod: 'ptyResize' | 'shellResize',
): void {
  try {
    fitAddon.fit();
    // Guard against sending 0 dimensions to PTY
    if (terminal.cols > 0 && terminal.rows > 0) {
      window.electronAPI[resizeMethod](sessionId, terminal.cols, terminal.rows);
    }
  } catch {
    // terminal may not be fully mounted or container has 0 size
  }
}

export function TerminalView({ sessionId, type, visible = true, fontFamily }: TerminalViewProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const resizeMethod = type === 'pty' ? 'ptyResize' : 'shellResize' as const;
  const writeMethod = type === 'pty' ? 'ptyWrite' : 'shellWrite' as const;
  const resolvedFont = fontFamily || DEFAULT_FONT_FAMILY;

  const getOrCreateTerminal = useCallback((key: string, sid: string): TerminalEntry => {
    const existing = terminalCache.get(key);
    if (existing) return existing;

    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: resolvedFont,
      fontSize: 13,
      lineHeight: 1,
      theme: currentXtermTheme,
      allowTransparency: false,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon((_event, url) => {
      window.electronAPI.openExternal(url);
    }));
    const searchAddon = new SearchAddon();
    terminal.loadAddon(searchAddon);

    const searchResult: SearchResult = { resultIndex: -1, resultCount: 0 };
    searchAddon.onDidChangeResults((e) => {
      searchResult.resultIndex = e.resultIndex;
      searchResult.resultCount = e.resultCount;
    });

    // Register data listener at creation time so background sessions keep receiving output
    const listenerMethod = type === 'pty' ? 'onPtyData' : 'onShellData';
    const removeDataListener = window.electronAPI[listenerMethod]((payload) => {
      if (payload.sessionId === sid) {
        terminal.write(payload.data);
      }
    });

    // Sync terminal title changes (e.g. Claude Code /rename) back to Chorus session name
    if (type === 'pty') {
      let lastTitle = '';
      terminal.onTitleChange((title: string) => {
        const trimmed = title.trim();
        if (trimmed && trimmed !== lastTitle) {
          lastTitle = trimmed;
          window.electronAPI.sessionRename(sid, trimmed);
        }
      });
    }

    const entry: TerminalEntry = { terminal, fitAddon, searchAddon, searchResult, mountedIn: null, opened: false, removeDataListener };
    terminalCache.set(key, entry);
    return entry;
  }, [type, resolvedFont]);

  // Attach terminal to DOM and handle I/O
  useEffect(() => {
    if (!sessionId || !containerRef.current || !visible) return;

    const key = getTerminalKey(type, sessionId);
    const isNewTerminal = !terminalCache.has(key);
    const entry = getOrCreateTerminal(key, sessionId);
    const { terminal, fitAddon } = entry;
    const container = containerRef.current;

    // Attach terminal to container via DOM reparenting.
    // terminal.open() can only be called once per Terminal instance.
    if (entry.mountedIn !== container) {
      container.innerHTML = '';
      if (!entry.opened) {
        // First time: initialize terminal into this container
        terminal.open(container);
        entry.opened = true;
      } else {
        // Subsequent mounts: reparent the existing terminal DOM element
        if (terminal.element) {
          container.appendChild(terminal.element);
        }
      }
      entry.mountedIn = container;
    }

    // Fit after a frame and refresh to render any data received while unmounted
    requestAnimationFrame(() => {
      safeFitAndResize(fitAddon, terminal, sessionId, resizeMethod);
      terminal.refresh(0, terminal.rows - 1);
      if (type === 'pty') {
        terminal.focus();
      }
    });
    const viewport = container.querySelector('.xterm-viewport');
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }

    // After renderer reload (Cmd+R), the PTY process is still alive but the
    // xterm buffer is empty. Force SIGWINCH by jiggling PTY dimensions so the
    // running program (Claude Code / shell) redraws its screen. Delayed to
    // ensure container layout is fully computed.
    let redrawTimer: ReturnType<typeof setTimeout> | undefined;
    if (isNewTerminal) {
      redrawTimer = setTimeout(() => {
        safeFitAndResize(fitAddon, terminal, sessionId, resizeMethod);
        if (terminal.cols > 1 && terminal.rows > 0) {
          window.electronAPI[resizeMethod](sessionId, terminal.cols + 1, terminal.rows);

          redrawTimer = setTimeout(() => {
            window.electronAPI[resizeMethod](sessionId, terminal.cols, terminal.rows);
          }, 10);
        }
      }, 10);
    }

    // Track terminal focus for search target resolution
    const handleFocusIn = (): void => { focusedTerminalKey = key; };
    const handleFocusOut = (): void => { if (focusedTerminalKey === key) focusedTerminalKey = null; };
    container.addEventListener('focusin', handleFocusIn);
    container.addEventListener('focusout', handleFocusOut);

    // Shift+Enter should insert a newline, not submit.
    // Claude Code enables kitty keyboard protocol (CSI u), so send the CSI u
    // encoding for Shift+Enter. Return false for ALL event types (keydown,
    // keypress, keyup) to prevent xterm from also sending \r.
    // Cmd+F is handled by the Electron menu accelerator — return false to
    // prevent xterm from inserting the character.
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.metaKey && !event.altKey && (event.key === 'f' || event.key === 'g')) {
        return false;
      }
      if (event.key === 'Enter' && event.shiftKey) {
        if (event.type === 'keydown') {
          const sid = sessionIdRef.current;
          if (sid) {
            window.electronAPI[writeMethod](sid, '\x1b[13;2u');
          }
        }
        return false;
      }
      return true;
    });

    // Handle user input -> send to main process
    const dataDisposable = terminal.onData((data) => {
      const sid = sessionIdRef.current;
      if (sid) {
        window.electronAPI[writeMethod](sid, data);
      }
    });

    // Resize observer with rAF debounce
    let resizeRafId = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeRafId);
      resizeRafId = requestAnimationFrame(() => {
        const sid = sessionIdRef.current;
        if (sid) {
          safeFitAndResize(fitAddon, terminal, sid, resizeMethod);
        }
      });
    });
    resizeObserver.observe(container);

    return () => {
      if (redrawTimer) clearTimeout(redrawTimer);
      dataDisposable.dispose();
      cancelAnimationFrame(resizeRafId);
      resizeObserver.disconnect();
      container.removeEventListener('focusin', handleFocusIn);
      container.removeEventListener('focusout', handleFocusOut);
      // Detach terminal DOM from container (don't dispose -- keep it alive for reparenting)
      if (terminal.element && terminal.element.parentNode === container) {
        container.removeChild(terminal.element);
      }
      entry.mountedIn = null;
    };
  }, [sessionId, type, visible, getOrCreateTerminal, resizeMethod, writeMethod]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: 'var(--bg-terminal)',
        display: visible ? 'block' : 'none',
      }}
    />
  );
}
