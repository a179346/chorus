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
`stage`/`stageUpdatedAt`): links PRs Claude created (reported by HookServer)
or the user added (`linkPrs`), unlinks them (`unlinkPr`), and keeps every PR's
stage current. A PR gh can't find stays linked with stage `not-found` until the
user removes it; a merged PR is final and no longer looked up. Owns debouncing, per-PR
in-flight dedup, gh concurrency limiting, and backoff when gh is unavailable. The GitHub lookup is an injectable adapter
(`GhRunner`; prod default `runGhPrView` spawns `gh pr view`), and the clock is
injectable — so the whole engine is unit-testable without gh or real timers.
Writes go through the SessionState commit seam.

### HookServer / HookInstaller — receipt vs installation

- `hook-server.ts` — the HTTP endpoint Claude Code hooks POST to. Maps hook
  events to status updates and forwards them via callbacks. When `gh pr create`
  (or the GitHub MCP create-pull-request tool) finishes, it reports the PR from
  the `PostToolUse` / `PostToolUseFailure` payload (`prsCreatedBy`); on Stop it
  reads the transcript (`transcript-reader.ts`) only for model and context
  usage. No settings-file knowledge.
- `hook-installer.ts` — writes/removes the Chorus hook entries in a project's
  `.claude/settings.local.json`, preserving user hooks and deduping across
  ports. No HTTP knowledge.

They share only the `HOOK_EVENTS` list.

### PtyManager (`pty-manager.ts`)

Owns the claude + shell PTY pair per session. Decoupled from Electron and the
hook server: Claude process exits are reported through
`setExitHandler(handler)`, which the composition root wires to
`sessionState.handleClaudeExit`. Only a session's *current* PTYs reach its
terminals and report claude's exit — ones that were killed, swapped out by
`restartClaude`, or replaced by a new `spawn` for the same id (which kills the
old pair) stay silent — and PTYs whose process already exited are never
signalled, since their PID may have been reused. Claude args are passed through
unchanged; they are validated when a session is created (see claude CLI
arguments below).

### Shell environment (`shell-env.ts`)

A packaged app opened from the Dock or at login gets launchd's minimal
environment. `readLoginShellEnv` starts `$SHELL -ilc` asynchronously and
captures its environment from `command env -0` between start/end markers:
rc-file output is ignored, an alias or function named `env` can't stand in,
and it resolves as soon as the end marker arrives (a background job started by
an rc file may keep the shell's output open). `resolveShellEnv` retries
through an injected prompt (`confirmRetry`) until it works or the user
continues without it. `userShell()` is the one default-shell rule (`$SHELL`,
else `/bin/zsh`), for this probe and the shell panel. The composition root
merges the result into `process.env`, then restores saved sessions. Until the
restore has run, the `SessionRestore` gate holds back everything that lists or
spawns sessions; it opens even if the restore fails (a dialog says so), and
`before-quit` saves only if the restore succeeded, since otherwise the store
doesn't hold the saved sessions.

### index.ts — the composition root

Constructs and wires the modules above, and registers IPC handlers. It also
owns system notifications: one per session, dismissed when the session is
looked at (switched to, or active when the window gains focus) or ended. The
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

The one place that knows claude's argument syntax. `checkSessionFlags` reads a
session's flags the way claude's option parser does, using a table of the
value-taking flags in `claude --help` (required / optional / variadic — it must
follow claude's flags): a value always goes with its flag and is never checked
as a flag; any other word (claude would take it as a prompt or subcommand) is
an error suggesting `--flag=value`; a trailing flag missing its required value
is an error. It also rejects flags Chorus manages
(`--session-id`/`--resume`/`--name`/`--worktree`…), flags that end the
interactive session in this terminal (`-p`, `--bg`, `--cloud`, `--environment`,
`--tmux`, `--rewind-files`…), and flags that turn off the hooks (`--bare`,
`--safe-mode`, `--restricted`, `--setting-sources` without `local`). The dialog
runs it live; main runs it again on create. `newSessionArgs` / `relaunchArgs`
build claude's launch arguments: Chorus's own flags first, then the session's
flags, and — first launch only — the prompt after `--` (a one-word prompt is
padded so claude can't take it for a subcommand); a relaunch uses `--resume`
once the session has user input, else `--session-id`/`--name`. Additional
Flags text is split with shell-style quoting only (no `~`, `$VAR` or `#`). The
checkbox flags, and the hint that points a typed checkbox flag to its
checkbox, live in `src/renderer/session-flags.ts`.

## Renderer (`src/renderer/`)

### terminals — the terminal host (`terminal-host.ts`)

Owns every xterm instance: the cache that keeps terminals (and their PTY data
listeners) alive across React unmounts, plus focus, search, fonts, and
theming. Callers address terminals by `(kind, sessionId)` through the
`terminals` object and never hold xterm objects. `TerminalView` is a thin
adapter that mounts a container and calls `terminals.attach`.

### useSessions — session state hook (`use-sessions.ts`)

Owns the renderer's session list and active-session state: subscribes to
`SESSION_STATE` pushes (only `SESSION_SYNC_FIELDS`), and exposes the session
verbs (create, end, restart, switch, next needing attention, rename, reorder,
toggle notify, link/unlink PR). `App.tsx` keeps only UI state.

### session-presentation (`session-presentation.ts`)

The one place session data is turned into visuals/labels: status colors,
pulsing statuses, stage icons (and the summary stage for a session's PRs),
path/model shortening. Components import from here instead of hand-rolling.
PR URL parsing (`parsePrUrl`, and `findPrUrls` for free text), formatting,
and PR identity (`prKey`, `samePr`) live in `src/shared/pr-ref.ts`, shared with
main.

### UI primitives (`ui.css` + `components/{Dialog,Menu,Checkbox,Kbd,StatusDot}.tsx`)

Anything with a hover, focus, or pressed state is a class in `ui.css`
(`btn`, `icon-btn`, `input`, `field-*`, `menu-item`, `kbd`, …), because inline
styles can't express pseudo-classes; layout stays inline. Modals go through
`Dialog` / `ConfirmDialog` (a backdrop that closes only on a press and release
on it, Escape, focus trap) and floating menus through `Menu` (viewport clamping
and scrolling; arrow keys, Home and End while focus is in it; closes on Escape,
Tab, an outside press, or focus leaving it), instead of each component
re-rolling them. Menus, dialogs and the command palette hand focus back to what
had it when they opened (`use-focus-return.ts`); when that element is gone,
`FocusFallbackContext` takes over, and App points it at the active Claude
terminal.

### Command palette (`components/CommandPalette.tsx`, `palette-items.tsx`, `palette-match.ts`)

`palette-match` is the pure ranking (prefix > word start > substring >
scattered letters). Every query word must match, in any order, and an item
ranks by its weakest word; a group's items stay together, and the group
holding the best match leads. Without a query everything keeps its order.
`palette-items` builds the
sessions / actions / toolkit list from App state, so a new action is one
entry there.
