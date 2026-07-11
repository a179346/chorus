# Architecture Context

Module vocabulary for Chorus. Each entry is a deep module: a small interface
hiding a real chunk of implementation. When touching session state, stages,
hooks, IPC, or terminals, go through these seams — don't reach around them.

## Main process (`src/main/`)

### SessionState — the commit seam (`session-state.ts`)

All session mutations flow through `sessionState.commit(sessionId, updates)`.
Commit updates the store, persists when a persisted field changed, broadcasts
exactly the changed fields to the renderer, and refreshes the unread badge
when `unread` changed. Higher-level entry points (`applyHookUpdate`,
`handleClaudeExit`, `markRead`) encode the unread/notification policy and end
in a commit. One deliberate exception: StageMonitor bumps `stageUpdatedAt` in
memory when a poll finds no change, skipping persist/broadcast.

If you need to change a session field, call `commit` — never
`updateSession` + `persistSessions` + `webContents.send` by hand.

### StageMonitor — the PR stage engine (`stage-monitor.ts`)

Watches sessions with a detected PR and keeps `stage`/`stageUpdatedAt`
current. Owns debouncing, in-flight dedup, gh concurrency limiting, and
backoff when gh is unavailable. The GitHub lookup is an injectable adapter
(`GhRunner`; prod default `runGhPrView` spawns `gh pr view`), and the clock is
injectable — so the whole engine is unit-testable without gh or real timers.
Writes go through the SessionState commit seam.

### HookServer / HookInstaller — receipt vs installation

- `hook-server.ts` — the HTTP endpoint Claude Code hooks POST to. Pure
  receipt: maps hook events to status updates and forwards them via callbacks.
  No filesystem knowledge.
- `hook-installer.ts` — writes/removes the Chorus hook entries in a project's
  `.claude/settings.local.json`, preserving user hooks and deduping across
  ports. No HTTP knowledge.

They share only the `HOOK_EVENTS` list.

### PtyManager (`pty-manager.ts`)

Owns the claude + shell PTY pair per session. Decoupled from Electron and the
hook server: Claude process exits are reported through
`setExitHandler(handler)`, which the composition root wires to
`sessionState.handleClaudeExit`.

### index.ts — the composition root

Constructs and wires the modules above, and registers IPC handlers. The
handler table is a mapped type over `IpcInvokeMap`, so the compiler enforces
that every declared channel has exactly one handler with the declared
payload/response types. Business logic belongs in the modules, not here.

## IPC — one typed registry (`src/shared/ipc.ts`)

Channel names, payloads, and responses are declared once in `IpcInvokeMap`
(request/response) and `IpcPushMap` (main → renderer push). Everything else
derives from it:

- main: the exhaustive `InvokeHandlers` table in `index.ts`
- preload: a generic whitelisted bridge (`window.chorusIpc`) that only checks
  the channel is known
- renderer: typed `invoke(channel, payload)` / `on(channel, cb)` wrappers in
  `src/renderer/ipc.ts`

Adding a channel = extend the map, add the handler (compiler errors until you
do), call `invoke`/`on`. No preload or `.d.ts` edits.

## Renderer (`src/renderer/`)

### terminals — the terminal host (`terminal-host.ts`)

Owns every xterm instance: the cache that keeps terminals (and their PTY data
listeners) alive across React unmounts, plus focus, search, fonts, and
theming. Callers address terminals by `(kind, sessionId)` through the
`terminals` object and never hold xterm objects. `TerminalView` is a thin
adapter that mounts a container and calls `terminals.attach`.

### useSessions — session state hook (`use-sessions.ts`)

Owns the renderer's session list and active-session state: subscribes to
`SESSION_STATE` pushes, and exposes the session verbs (create, end, switch,
rename, reorder, toggle notify). `App.tsx` keeps only UI state.

### session-presentation (`session-presentation.ts`)

The one place session data is turned into visuals/labels: status colors,
pulsing statuses, stage icons, PR URLs, path/model shortening. Components
import from here instead of hand-rolling.
