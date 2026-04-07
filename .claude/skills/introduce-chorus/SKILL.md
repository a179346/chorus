---
name: introduce-chorus
description: "Write a compelling 'About' or introduction section for the Chorus project. Use this skill whenever the user asks to introduce Chorus, write an About page, create a project description, draft a README intro, pitch the project, or explain what Chorus does to someone unfamiliar with it. Also trigger when the user asks to 'sell' the project, write marketing copy for it, or create a landing page description."
---

# Introduce Chorus

Generate a concise, high-impact introduction for Chorus — a multi-session Claude Code terminal manager built with Electron + React.

## Process

1. **Analyze the codebase first.** Read `package.json`, `CLAUDE.md`, `README.md`, and scan the `src/` directory to understand what's actually built — not what's aspirational. Ground every claim in real code.

2. **Lead with the problem.** Developers running multiple Claude Code sessions lose track of which window is doing what, miss when sessions finish thinking, and waste time context-switching. Chorus exists because tabbing through terminal windows is not session management.

3. **Highlight these 3 standout features** — these are the core value props, in order of importance:

   1. **Live session status** — Each session shows its real-time state (idle, thinking, generating, etc.) right in the sidebar. You can see at a glance what every session is doing without switching tabs. No more cycling through terminal windows wondering "is it done yet?" The status comes from Claude Code's hook system, so it's accurate and instant.

   2. **Unread indicators** — When a session finishes its work while you're focused on another session, it gets marked as unread. You always know which sessions have new output waiting for your attention — like unread messages, but for your coding sessions.

   3. **System notifications** — When you switch away from Chorus entirely (browsing docs, reviewing a PR, grabbing coffee), you get a native macOS notification the moment Claude finishes. Includes a dock badge showing how many sessions need attention. You never have to keep checking back.

   These three features work together to solve one thing: you can run multiple Claude sessions and never lose track of any of them. Present them concretely — describe what the user *sees* and *experiences*, not the implementation.

4. **Write in plain English.** No corporate jargon ("leverage", "empower", "streamline"). Write like you're explaining it to a sharp developer friend over coffee. Be specific — "shows context usage as a color-coded bar" beats "provides visibility into resource consumption."

5. **Keep it punchy.** Aim for 150-250 words total. Structure:
   - One-liner hook (what it is, why you'd care)
   - The problem (2-3 sentences max)
   - The 3 features (short paragraph or bullet list)
   - Closing line that makes someone want to try it

## Output format

Return the introduction as markdown. Use a `## About` or `## What is Chorus?` heading. No badges, no shields, no table of contents — just the writing.

## Tone

Confident but not arrogant. Technical but readable. Think of how Linear, Raycast, or Warp describe themselves — direct, specific, no fluff.

## Example structure

```markdown
## What is Chorus?

[One-liner: what it is + why it matters]

[The problem: what's broken about the status quo]

[Feature 1 — most impressive, described concretely]
[Feature 2 — second most impressive]
[Feature 3 — third, ideally something unexpected/delightful]

[Closing: why this is worth installing right now]
```
