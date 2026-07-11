---
name: verify
description: How to launch and drive a Chorus dev instance for runtime verification without touching the user's running app or ~/.chorus state.
---

# Verifying Chorus changes at runtime

## Hazards (check first)

- The user usually has the **packaged Chorus running** (`out/Chorus-darwin-arm64/...`). It shares `~/.chorus` (sessions.json, state.json) with any dev instance — never launch dev with the real HOME.
- Launching with real HOME also `--resume`s every persisted session, spawning duplicate `claude` processes (possibly including the very session you are running in).

## Launch (isolated HOME)

```bash
NODEBIN=$(dirname "$(node -e 'console.log(process.execPath)')")   # asdf shims break when HOME changes (exit 126) — use the real bin
FAKEHOME=<scratch>/fakehome && mkdir -p "$FAKEHOME"
tail -f /dev/null | PATH="$NODEBIN:$PATH" HOME=$FAKEHOME "$NODEBIN/npx" electron-forge start > <scratch>/forge.log 2>&1   # run in background
```

- `tail -f /dev/null |` keeps stdin open; forge exits immediately when stdin closes.
- Dev mode opens remote debugging on **port 9222** (`src/main/index.ts`). Poll `http://localhost:9222/json/list` until ready (~15s first time, ~1s with warm vite cache).
- If 9222 says "Address already in use" in the log, a previous dev instance is still alive — see cleanup.

## Drive

`npm i playwright-core` in a scratch dir, then:

```js
const browser = await require('playwright-core').chromium.connectOverCDP('http://localhost:9222');
const page = browser.contexts()[0].pages()[0];
```

Useful selectors: `[aria-label="New Session"]` (sidebar + button), `[role="dialog"]`, inputs by placeholder (`"my-session"`, `"/Users/..."`), `button[type="submit"]`.

- Spawned `claude` args are observable via `ps -eo args | grep "[c]laude --no-chrome"`.
- With fake HOME, spawned `claude` shows first-run onboarding and `gh` is unauthenticated (PR stage lookups return unavailable) — expected; verify PR linkage via `$FAKEHOME/.chorus/session-*.json` instead.

## Cleanup

```bash
pkill -f "chorus/node_modules/electron"; pkill -f "electron-forge"
pkill -f "session-id <test-session-uuid>"   # any claude spawned by test sessions
```

Never `pkill -f Chorus` — that matches the user's production app.
