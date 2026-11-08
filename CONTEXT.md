# Architecture Context

Module vocabulary for Chorus. Each entry is a deep module: a small interface
hiding a real chunk of implementation. When touching session state, stages,
hooks, IPC, or terminals, go through these seams — don't reach around them.

## Main process (`src/main/`)

### SessionState — the commit seam (`session-state.ts`)

All session mutations flow through `sessionState.commit(sessionId, updates)`.
Commit updates the store, persists when what is saved for the session changed
(a persisted field, or whether claude has exited), broadcasts
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
(`GhRunner`; prod default `runGhPrView` spawns `gh pr view -R github.com/<owner>/<repo>`,
pinned to github.com whatever host gh defaults to), and the clock is
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

Owns each session's claude + shell PTYs. A session can hold just its shell:
`spawnShell` starts one whose claude isn't running (a session restored after
its claude had exited), and a claude that exits leaves the shell in place;
`restartClaude` starts claude for either, replacing a running one. A new claude
starts at the size the session's Claude terminal last asked for
(`resizeClaude` keeps it even while no claude runs). Decoupled from Electron
and the hook server: Claude process exits are reported through
`setExitHandler(handler)`, which the composition root wires to
`sessionState.handleClaudeExit`. Only a session's *current* PTYs reach its
terminals and report claude's exit — ones that were killed, swapped out by
`restartClaude`, or replaced by a new `spawn`/`spawnShell` for the same id
(which kills the old ones) stay silent — and PTYs whose process already exited
are never signalled or resized, since their PID or descriptor may have been
reused. Claude args are passed through unchanged; they are validated when a
session is created (see claude CLI arguments below).

### Shell environment (`shell-env.ts`)

A packaged app opened from the Dock or at login gets launchd's minimal
environment. `readLoginShellEnv` starts `$SHELL` as an interactive login shell
asynchronously (`-ilc`; csh and tcsh, versioned names like `tcsh-6.24`
included, which take `-l` only on its own, get
`-ic` and a `-` before their name in argv[0], as login(1) gives them) and
captures its environment from `command env -0` between start/end markers (the
end marker only follows a successful env, so a failed env rejects instead of
reading as empty):
rc-file output is ignored, an alias or function named `env` can't stand in,
and it resolves as soon as the end marker arrives (a background job started by
an rc file may keep the shell's output open). `resolveShellEnv` retries
through an injected prompt (`confirmRetry`) until it works or the user
continues without it. `userShell()` is the one default-shell rule (`$SHELL`,
else `/bin/zsh`), for this probe and the shell panel. The composition root
merges the result into `process.env`, then restores saved sessions: each one
the user has prompted comes back as it was saved — claude resuming its
conversation, or, if claude had exited, only its shell, showing the exited
banner until the user restarts it — and the ones that can't be restored
(directory gone, PTYs didn't spawn) go to Recently Closed, in one write once
every restorable session is running. Each leaves the saved sessions only after
that write succeeds (otherwise it is retried next launch), and stays in Recently
Closed, outside its limit of ten, until it is reopened or removed. A reopen
that fails says why and offers to remove the session; it stays unless the
user picks Remove (Escape keeps it), since a missing volume may come back, and
is then marked like one whose restore failed. ⌘⇧T reopens the latest session
the user closed, passing over ones that couldn't be restored or reopened;
those are reopened from the Recently Closed submenu and stay outside the limit
until reopened or removed. Once a reopen succeeds, the sessions are saved
before it leaves Recently Closed; a write that fails there, or after the
failure dialog's choice, is shown in a native dialog.
Until the restore has run, the `SessionRestore` gate holds back everything
that lists or spawns sessions; it opens even if the restore fails (a dialog
says so). The store never drops a saved session it hasn't restored or removed:
those stay in the index and keep their files through every write and the
orphan cleanup, so `before-quit` can always save.

### Toolkit commands (`session-store.ts`)

toolkit.json is edited by hand too, so each command is checked as it is read,
and an edit leaves every other entry and top-level key as written (an updated
command is replaced whole). A command is run, edited and deleted by id. An
entry goes by its own id when no other entry has it; otherwise (none, or shared
with a pasted copy) by `command-<8 hex>` derived from its label and command, so
adding, moving or deleting other entries by hand doesn't change it — only twins
with the same label and command are told apart by order (`-2`, `-3`…), and no
derived id is any entry's own. Loading never writes. Each edit first writes
every command's id into its entry, so it stays put when the label or command is
later changed by hand, and responds (`TOOLKIT_ADD`/`UPDATE`/`DELETE`) with the
commands it wrote; the renderer replaces its list with them. An id no command
goes by means toolkit.json changed outside Chorus: deleting it succeeds without
writing (it's already gone) and returns the list; updating or running it
(`TOOLKIT_EXECUTE`) is refused with a message saying so, and the renderer
reloads the list (`TOOLKIT_LIST`) — an open dialog still shows why. A
toolkit.json that isn't JSON with a `commands` list loads as empty and is never
overwritten.

### index.ts — the composition root

Constructs and wires the modules above, and registers IPC handlers. It also
owns system notifications: one per session, dismissed when the session is
looked at (switched to, or active when the window gains focus) or closed. A
relaunch (Restart, restore, reopen) runs claude in the session's worktree;
when claude has removed it (it does on exit when the worktree is clean),
claude runs from the session's cwd with `--worktree <name>` and recreates it.
The handler table is a mapped type over `IpcInvokeMap`, so the compiler enforces
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
session's flags the way claude's option parser does, using two tables that
must follow claude's flags: the value-taking flags (required / optional /
variadic) in `claude --help` plus hidden ones a user is likely to type
(`--system-prompt-file`, `--thinking`, `--channels`…), and every flag
claude declares that takes no value, hidden ones included (`--init`,
`--maintenance`, `--enable-auto-mode`…); as in claude's parser, an argument
that is a whole known flag names it (`-d2e` isn't `-d` with a value). A value always goes
with its flag and is never checked as a flag; a value attached to a flag that
takes none (`--verbose=true`, which claude refuses) is an error; any other word
(claude would take it as a prompt or subcommand) is an error — after a flag
that takes no value it says so, after a flag in neither table it suggests
`--flag=value`; a trailing flag missing its required value is an error. It
also rejects flags Chorus manages (`--session-id`/`--resume`/`--name`/
`--worktree`…), flags that end the interactive session in this terminal (`-p`,
`--bg`, `--cloud`, `--environment`, `--tmux`, `--rewind-files`…), flags a
host or team lead sets when it launches claude (`--session-mirror`,
`--reply-on-resume`, `--managed-settings`, `--deep-link-*`, `--agent-id`,
`--team-name`…), and flags
that turn off the hooks (`--bare`, `--safe-mode`, `--restricted`,
`--project-config-root`, and a `--setting-sources` without `local` or naming
anything but `user`/`project`/`local`); what a `--settings` file or JSON holds
isn't inspected. The dialog runs it live; main runs it again on create,
checkbox flags included. `newSessionArgs` / `relaunchArgs` build claude's
launch arguments: Chorus's own flags first, then the session's flags, and —
first launch only — the prompt after `--` (a one-word prompt is padded so
claude can't take it for a subcommand); a relaunch uses `--resume` once the
session has user input, else `--session-id`/`--name`, plus `--worktree <name>`
when asked to recreate a worktree whose directory is gone. Additional Flags
text is split with shell-style quoting only (no `~`, `$VAR` or `#`). The
checkbox flags, and the hint that points a typed checkbox flag to its
checkbox, live in `src/renderer/session-flags.ts`.

## Renderer (`src/renderer/`)

### terminals — the terminal host (`terminal-host.ts`)

Owns every xterm instance: the cache that keeps terminals (and their PTY data
listeners) alive across React unmounts, plus focus, search, fonts, and
theming. Callers address terminals by `(kind, sessionId)` through the
`terminals` object and never hold xterm objects. `TerminalView` is a thin
adapter that mounts a container and calls `terminals.attach`. Attaching never
moves focus: App's `focusActiveClaude` is the one place that puts the keyboard
in the active session's Claude terminal (on switching sessions, after a
restart or a toolkit run, and — only if focus is still lost a frame later —
after a rename or as the focus fallback), and it never
takes focus from an open dialog or the palette.

### useSessions — session state hook (`use-sessions.ts`)

Owns the renderer's session list and active-session state: subscribes to
`SESSION_STATE` pushes (only `SESSION_SYNC_FIELDS`), and exposes the session
verbs (create, end, restart, switch, next needing attention, rename, reorder,
toggle notify, link/unlink PR). The active session is decided here: once both the session list and app state
arrive, sessions main pushed ahead of the list (a reopen as restore finishes)
are kept, and the active one is a session picked meanwhile (revealed or
reopened) if listed, else the saved last-active session if it came back, else
the first; a created or reopened session becomes active; when the active
session ends, the first remaining one, else none. The verbs (end, switch, next
needing attention) go by the latest pick at once, ahead of the re-render that
shows it; `activeSessionIdRef` is the session on screen, for App. Every change goes to
main (`SESSION_SWITCH`, or `lastActiveSessionId: null` for none), which saves
it and marks the shown session seen. Only a listed session is active. `App.tsx` keeps only UI state.

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
Tab, a press outside it and its `anchorRef` (the trigger, whose own click
toggles it), focus moving anywhere outside it, or the window losing focus),
instead of each component re-rolling them. Menus and the command palette close
when focus moves outside them (`use-close-on-focus-outside.ts`), but not for
focus going back where it came from as they close. A dialog's async submit
(create, save, delete) goes through `useAsyncSubmit` (`use-async-submit.ts`):
it runs once at a time; on success it stays pending until the owner closes the
dialog, which unmounts it (form dialogs are mounted only while open and keyed
per opening, so each opening starts blank, and opening one that is already
open keeps it), and on rejection it ends and the dialog shows why. The error clears on
the next submit and, in forms, on any edit. While a submit is pending the dialog
ignores Escape, the backdrop and Cancel (`aria-disabled`, not `disabled`, so
focus stays in the form). Menus, dialogs and the command palette hand focus
back to what had it when they opened (`use-focus-return.ts`); when that element
is gone (or the same update removes it right after focus went back),
`FocusFallbackContext` takes over: App focuses the active Claude terminal a
frame later, only if nothing has taken focus by then (e.g. a find bar opened
by a palette action).

### Command palette (`components/CommandPalette.tsx`, `palette-items.tsx`, `palette-match.ts`)

`palette-match` is the pure ranking (prefix > word start > substring >
scattered letters). The query splits into words at the same breaks as item
text (spaces, `-`, `_`, `.`, `/`), except that a `/` starting a query word
stays part of it, so `/pr` finds a toolkit command by its slash command; every word must match, in any order, and an item
ranks by its weakest word; a group's items stay together, and the group
holding the best match leads. Without a query everything keeps its order.
`palette-items` builds the
sessions / actions / toolkit list from App state, so a new action is one
entry there.
