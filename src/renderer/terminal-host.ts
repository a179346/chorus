import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { getTheme, DEFAULT_THEME_ID } from './themes';
import type { XtermColors, SearchDecorations } from './themes';
import { invoke, on, IpcChannels } from './ipc';

// Owns every xterm instance in the app: the cache that keeps terminals (and
// their PTY data listeners) alive across React unmounts, focus tracking,
// search, fonts, and theming. Callers hold no xterm objects — everything is
// addressed by (kind, sessionId) through the `terminals` interface below.

export type TerminalKind = 'pty' | 'shell';

export interface SearchResult {
  resultIndex: number;
  resultCount: number;
}

const DEFAULT_FONT_FAMILY =
  "'MesloLGS NF', 'JetBrains Mono', 'IBM Plex Mono', 'SF Mono', 'Fira Code', monospace";
const DEFAULT_FONT_SIZE = 13;

interface TerminalEntry {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  searchResult: SearchResult;
  mountedIn: HTMLElement | null;
  opened: boolean;
  removeDataListener: (() => void) | null;
}

const cache = new Map<string, TerminalEntry>();
let focusedKey: string | null = null;

let currentXtermTheme: XtermColors = getTheme(DEFAULT_THEME_ID).xtermTheme;
let currentSearchDecorations: SearchDecorations = getTheme(DEFAULT_THEME_ID).searchDecorations;

function keyOf(kind: TerminalKind, sessionId: string): string {
  return `${kind}:${sessionId}`;
}

const KIND_CHANNELS = {
  pty: {
    data: IpcChannels.PTY_DATA,
    write: IpcChannels.PTY_WRITE,
    resize: IpcChannels.PTY_RESIZE,
  },
  shell: {
    data: IpcChannels.SHELL_DATA,
    write: IpcChannels.SHELL_WRITE,
    resize: IpcChannels.SHELL_RESIZE,
  },
} as const satisfies Record<TerminalKind, unknown>;

function dataChannel(kind: TerminalKind) {
  return KIND_CHANNELS[kind].data;
}

function writeToPty(kind: TerminalKind, sessionId: string, data: string): void {
  void invoke(KIND_CHANNELS[kind].write, { sessionId, data });
}

function resizePty(kind: TerminalKind, sessionId: string, cols: number, rows: number): void {
  void invoke(KIND_CHANNELS[kind].resize, { sessionId, cols, rows });
}

/**
 * Force xterm to recompute the DOM viewport's scroll-area height and
 * scrollTop from the internal buffer. Writes that arrive while a terminal is
 * detached from the DOM run xterm's viewport refresh against a 0-height
 * element, leaving stale scroll metrics that make trackpad scrolling jump
 * and stop short of the bottom after reattach. Nothing on the public API
 * triggers this resync, so reach into _core (the same escape hatch xterm
 * addons use).
 */
function syncViewport(terminal: Terminal): void {
  const core = (terminal as unknown as { _core?: { viewport?: { syncScrollArea(immediate?: boolean): void } } })
    ._core;
  core?.viewport?.syncScrollArea(true);
}

function safeFitAndResize(entry: TerminalEntry, kind: TerminalKind, sessionId: string): void {
  try {
    entry.fitAddon.fit();
    // Guard against sending 0 dimensions to PTY
    if (entry.terminal.cols > 0 && entry.terminal.rows > 0) {
      resizePty(kind, sessionId, entry.terminal.cols, entry.terminal.rows);
    }
  } catch {
    // terminal may not be fully mounted or container has 0 size
  }
}

/**
 * Create a cached Terminal for the given session if one doesn't exist yet,
 * and register its PTY/shell data listener immediately. The terminal is not
 * mounted to the DOM — that happens in attach() — but the listener captures
 * output as soon as the PTY emits it, so background sessions don't lose the
 * resume-time conversation history.
 */
function preload(
  kind: TerminalKind,
  sessionId: string,
  fontFamily?: string,
  fontSize?: number,
): TerminalEntry {
  const key = keyOf(kind, sessionId);
  const existing = cache.get(key);
  if (existing) return existing;

  const terminal = new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    cursorStyle: 'bar',
    fontFamily: fontFamily || DEFAULT_FONT_FAMILY,
    fontSize: fontSize && fontSize > 0 ? fontSize : DEFAULT_FONT_SIZE,
    lineHeight: 1,
    theme: currentXtermTheme,
    allowTransparency: false,
    scrollback: 10000,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(
    new WebLinksAddon((_event, url) => {
      void invoke(IpcChannels.SHELL_OPEN_EXTERNAL, { url });
    }),
  );
  const searchAddon = new SearchAddon();
  terminal.loadAddon(searchAddon);

  const searchResult: SearchResult = { resultIndex: -1, resultCount: 0 };
  searchAddon.onDidChangeResults((e) => {
    searchResult.resultIndex = e.resultIndex;
    searchResult.resultCount = e.resultCount;
  });

  // Register data listener at creation time so background sessions keep receiving output
  const removeDataListener = on(dataChannel(kind), (payload) => {
    if (payload.sessionId === sessionId) {
      terminal.write(payload.data);
    }
  });

  // Sync terminal title changes (e.g. Claude Code /rename) back to Chorus session name
  if (kind === 'pty') {
    let lastTitle = '';
    terminal.onTitleChange((title: string) => {
      const trimmed = title.trim();
      if (trimmed && trimmed !== lastTitle) {
        lastTitle = trimmed;
        void invoke(IpcChannels.SESSION_RENAME, { id: sessionId, name: trimmed });
      }
    });
  }

  const entry: TerminalEntry = {
    terminal,
    fitAddon,
    searchAddon,
    searchResult,
    mountedIn: null,
    opened: false,
    removeDataListener,
  };
  cache.set(key, entry);
  return entry;
}

interface AttachOptions {
  fontFamily?: string;
  fontSize?: number;
}

/**
 * Mount a session's terminal into a container and wire up input, focus
 * tracking, and resizing. Returns a cleanup that detaches the DOM but keeps
 * the terminal alive in the cache for reattachment.
 */
function attach(
  kind: TerminalKind,
  sessionId: string,
  container: HTMLElement,
  opts: AttachOptions = {},
): () => void {
  const key = keyOf(kind, sessionId);
  const isNewTerminal = !cache.has(key);
  const entry = preload(kind, sessionId, opts.fontFamily, opts.fontSize);
  const { terminal } = entry;

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
    safeFitAndResize(entry, kind, sessionId);
    terminal.refresh(0, terminal.rows - 1);
    syncViewport(terminal);
    if (kind === 'pty') {
      terminal.focus();
    }
  });

  // After renderer reload (Cmd+R), the PTY process is still alive but the
  // xterm buffer is empty. Force SIGWINCH by jiggling PTY dimensions so the
  // running program (Claude Code / shell) redraws its screen. Delayed to
  // ensure container layout is fully computed.
  let redrawTimer: ReturnType<typeof setTimeout> | undefined;
  if (isNewTerminal) {
    redrawTimer = setTimeout(() => {
      safeFitAndResize(entry, kind, sessionId);
      if (terminal.cols > 1 && terminal.rows > 0) {
        resizePty(kind, sessionId, terminal.cols + 1, terminal.rows);

        redrawTimer = setTimeout(() => {
          resizePty(kind, sessionId, terminal.cols, terminal.rows);
        }, 10);
      }
    }, 10);
  }

  // Track terminal focus for search target resolution
  const handleFocusIn = (): void => {
    focusedKey = key;
  };
  const handleFocusOut = (): void => {
    if (focusedKey === key) focusedKey = null;
  };
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
        writeToPty(kind, sessionId, '\x1b[13;2u');
      }
      return false;
    }
    return true;
  });

  // Handle user input -> send to main process
  const dataDisposable = terminal.onData((data) => {
    writeToPty(kind, sessionId, data);
  });

  // Resize observer with rAF debounce
  let resizeRafId = 0;
  const resizeObserver = new ResizeObserver(() => {
    cancelAnimationFrame(resizeRafId);
    resizeRafId = requestAnimationFrame(() => {
      safeFitAndResize(entry, kind, sessionId);
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
    // Detach terminal DOM from container (don't dispose — keep it alive for reparenting)
    if (terminal.element && terminal.element.parentNode === container) {
      container.removeChild(terminal.element);
    }
    entry.mountedIn = null;
  };
}

function focus(kind: TerminalKind, sessionId: string): void {
  cache.get(keyOf(kind, sessionId))?.terminal.focus();
}

/** Dispose both of a session's terminals and drop them from the cache. */
function dispose(sessionId: string): void {
  for (const kind of ['pty', 'shell'] as const) {
    const key = keyOf(kind, sessionId);
    const entry = cache.get(key);
    if (entry) {
      entry.removeDataListener?.();
      entry.terminal.dispose();
      cache.delete(key);
    }
  }
}

function focused(): { kind: TerminalKind; sessionId: string } | null {
  if (!focusedKey) return null;
  const [kind, ...rest] = focusedKey.split(':');
  return { kind: kind as TerminalKind, sessionId: rest.join(':') };
}

function findNext(kind: TerminalKind, sessionId: string, term: string): SearchResult {
  const entry = cache.get(keyOf(kind, sessionId));
  if (!entry) return { resultIndex: -1, resultCount: 0 };
  entry.searchAddon.findNext(term, { decorations: currentSearchDecorations });
  return { ...entry.searchResult };
}

function findPrevious(kind: TerminalKind, sessionId: string, term: string): SearchResult {
  const entry = cache.get(keyOf(kind, sessionId));
  if (!entry) return { resultIndex: -1, resultCount: 0 };
  entry.searchAddon.findPrevious(term, { decorations: currentSearchDecorations });
  return { ...entry.searchResult };
}

function clearSearch(kind: TerminalKind, sessionId: string): void {
  cache.get(keyOf(kind, sessionId))?.searchAddon.clearDecorations();
}

export interface TerminalSettingsUpdate {
  fontFamily?: string;
  claudeFontSize?: number;
  shellFontSize?: number;
}

/**
 * Apply font family and per-kind font size updates to all cached terminals,
 * refit once per terminal, and notify the corresponding PTY of new dimensions.
 * Pass only the keys you want to change.
 */
function applySettings(update: TerminalSettingsUpdate): void {
  for (const [key, entry] of cache.entries()) {
    const isPty = key.startsWith('pty:');
    const kind: TerminalKind = isPty ? 'pty' : 'shell';
    const sessionId = key.slice(isPty ? 4 : 6);
    let changed = false;

    try {
      if (update.fontFamily !== undefined) {
        entry.terminal.options.fontFamily = update.fontFamily;
        changed = true;
      }
      const newSize = isPty ? update.claudeFontSize : update.shellFontSize;
      if (newSize !== undefined && newSize > 0) {
        entry.terminal.options.fontSize = newSize;
        changed = true;
      }
    } catch {
      // Terminal may have been disposed concurrently; skip it.
      continue;
    }

    if (changed) {
      safeFitAndResize(entry, kind, sessionId);
    }
  }
}

/** Update the xterm theme on all cached terminal instances. */
function setTheme(xtermTheme: XtermColors, searchDecorations: SearchDecorations): void {
  currentXtermTheme = xtermTheme;
  currentSearchDecorations = searchDecorations;
  for (const entry of cache.values()) {
    entry.terminal.options.theme = xtermTheme;
  }
}

export const terminals = {
  preload,
  attach,
  focus,
  dispose,
  focused,
  findNext,
  findPrevious,
  clearSearch,
  applySettings,
  setTheme,
};
