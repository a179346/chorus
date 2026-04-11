---
name: release-chorus
description: Automate a full Chorus release — bump version, build artifacts, generate release notes, and publish a GitHub release. Use this skill whenever the user says /release-chorus, mentions releasing a new version, shipping a build, publishing Chorus, cutting a release, or wants to push a new version to GitHub.
---

# Release Chorus

Automate the full release pipeline for the Chorus Electron app. This skill handles version bumping, building, release notes, and GitHub release creation in one flow.

## Prerequisites

Before starting, confirm:
- Working tree is clean (`git status` — no uncommitted changes). If dirty, stop and ask the user to commit or stash first.
- You are on the `main` branch. If not, warn the user and ask if they want to proceed anyway.

## Step 1: Determine Version Bump from PRs

The version bump is determined automatically by scanning merged PR labels since the last release. No need to ask the user.

1. Read `package.json` to get the current version. The previous release tag is `v<current-version>` (e.g. if version is `0.1.0`, the previous tag is `v0.1.0`).
2. Check if that tag exists: `git rev-parse v<current-version> 2>/dev/null`. If it doesn't exist, this is the first release — use all merged PRs.
3. Find the commit date of the previous tag to scope the PR query: `git log -1 --format=%aI v<current-version>`
4. List merged PRs since the previous release using `gh pr list --state merged --search "merged:>YYYY-MM-DD" --json number,title,labels --limit 100`. If first release, omit the date filter and fetch all merged PRs. **Save this PR list — it will be reused in Step 4 for release notes.**
5. Scan the labels on each PR and determine the bump level using **highest wins**:

   | PR Label   | Bump Level |
   |------------|------------|
   | `major`    | **major**  |
   | `minor`    | minor      |
   | `feature`  | minor      |
   | `patch`    | patch      |
   | `fix`      | patch      |
   | `chore`    | patch      |
   | `ci`       | patch      |
   | `docs`     | patch      |

   Precedence: major > minor > patch. If any PR has `major`, it's a major bump. Otherwise if any has `minor` or `feature`, it's minor. Everything else is patch.

6. If no merged PRs are found (or none have labels), default to **patch**.
7. Show the user the detected bump level and the PRs that determined it, then proceed.

## Step 2: Bump Version

1. Read `package.json` and extract the current `version` field (semver format: `MAJOR.MINOR.PATCH`).
2. Apply the bump determined in Step 1:
   - `patch`: 0.1.0 → 0.1.1
   - `minor`: 0.1.0 → 0.2.0
   - `major`: 0.1.0 → 1.0.0
3. Update the `version` field in `package.json`.
4. Commit with message: `chore: bump version to <new-version>`

## Step 3: Build Artifacts

1. Remove the `out/` directory: `rm -rf out`
2. Run `npm run make` to produce the new build. This may take a while — use a longer timeout (up to 10 minutes).
3. After the build completes, locate the `.dmg` and `.zip` files. They will be under `out/make/`:
   - DMG: `out/make/*.dmg`
   - ZIP: `out/make/zip/darwin/arm64/*.zip` (or similar arch path)
4. Verify both files exist. If either is missing, report the error and stop.
5. Push the version bump commit: `git push`. This ensures we only push after a successful build.

## Step 4: Generate Release Notes

1. **If first release** (no previous tag existed in Step 1): skip PR lookup. Instead, read the source code under `src/` to understand what the app does, then write a high-level summary of the initial feature set as the release notes. Focus on user-facing capabilities, not implementation details.
2. **For subsequent releases**: reuse the PR list already fetched in Step 1. Write release notes in Markdown, grouping PRs by label into the following sections (omit empty sections):

```markdown
## Feature
- PR title (#number)

## Fix
- PR title (#number)

## Docs
- PR title (#number)

## CI
- PR title (#number)

## Chore
- PR title (#number)
```

   PRs without a matching label go under **Chore**. Keep descriptions concise — use the PR title as-is or lightly rewrite for clarity.

## Step 5: Create GitHub Release

Use the `gh` CLI to create the release:

```bash
gh release create v<new-version> \
  <path-to-dmg> \
  <path-to-zip> \
  --title "Chorus v<new-version>" \
  --notes "<release-notes>"
```

Use a heredoc for `--notes` if the notes are multiline. After creation, report the release URL back to the user.

## Error Handling

- If `npm run make` fails, show the error output and stop. Do not create a GitHub release with missing artifacts.
- If `gh release create` fails (e.g., not authenticated), tell the user to run `gh auth login` first.
- If the git push fails (e.g., no remote, auth issue), stop and report — don't create a GitHub release without the commit pushed.
