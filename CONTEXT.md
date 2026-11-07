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
in a commit. One deliberate exception: StageMonitor bumps a linked PR's
`stageUpdatedAt` in memory when a poll finds no change, skipping
persist/broadcast.

If you need to change a session field, call `commit` — never
`updateSession` + `persistSessions` + `webContents.send` by hand.

### StageMonitor — the PR stage engine (`stage-monitor.ts`)

Owns each session's linked PRs (`session.prs`, each with its own
`stage`/`stageUpdatedAt`): links PRs found in the transcript
(`handlePrsDetected`) or added by the user (`linkPrs`), unlinks them
(`unlinkPr`, remembered in `session.unlinkedPrs` so transcript detection won't
re-link them), and keeps every PR's stage current. Owns debouncing, per-PR
in-flight dedup, gh concurrency limiting, and backoff when gh is unavailable. The GitHub lookup is an injectable adapter
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
`sessionState.handleClaudeExit`. Only a session's *current* claude PTY
reports its exit — one that was killed or swapped out by `restartClaude`
stays silent — and PTYs whose process already exited are never signalled,
since their PID may have been reused. Claude args are passed through
unchanged; they are validated when a session is created (see claude CLI
arguments below).

### Shell environment (`shell-env.ts`)

A packaged app opened from the Dock or at login gets launchd's minimal
environment. `readLoginShellEnv` starts `$SHELL -ilc` asynchronously and
captures its whole environment (after a sentinel, so rc-file output is
ignored); `resolveShellEnv` retries through an injected prompt
(`confirmRetry`) until it works or the user continues without it. The
composition root merges the result into `process.env`, then restores saved
sessions. Until then the `sessionsReady` promise holds back everything that
lists or spawns sessions, and `before-quit` skips saving, because the store is
still empty.

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

## claude CLI arguments (`src/shared/claude-cli.ts`)

The one place that knows claude's argument syntax: the flags a session can't
take (`unsupportedFlagError` — Chorus's own `--session-id`/`--resume`/`--name`/
`--worktree`, and flags that end the interactive session; the dialog checks it
and main checks it again on create), shell-like parsing/formatting of the
Additional Flags text, and `initialPromptArgs` — the first prompt goes after
`--`, and a one-word prompt is padded so claude can't take it for a
subcommand. The dialog's checkbox flags and its Additional Flags validation
live in `src/renderer/session-flags.ts`.

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
rename, reorder, toggle notify, link/unlink PR). `App.tsx` keeps only UI state.

### session-presentation (`session-presentation.ts`)

The one place session data is turned into visuals/labels: status colors,
pulsing statuses, stage icons (and the summary stage for a session's PRs),
path/model shortening. Components import from here instead of hand-rolling.
PR URL parsing/formatting and PR identity (`samePr`) live in
`src/shared/pr-ref.ts`, shared with main.
