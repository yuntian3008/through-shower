---
description: Read-only inspection of the thought-shower pipeline state on the current branch. Reports git + GitHub state and the inferred next stage. No side effects.
---

# /thought-shower:status

Read-only state report. No actions, no prompts.

## Steps

Run all checks in parallel via `Bash`. Compose into a single report.

### Git state

```bash
git branch --show-current                           # FEATURE_BRANCH
git rev-parse --abbrev-ref @{upstream} 2>/dev/null  # upstream (may not exist)
git status --porcelain | wc -l                      # dirty file count
git log --oneline @{upstream}..HEAD 2>/dev/null     # commits ahead of upstream
```

### PR state

```bash
gh pr view --json number,url,state,isDraft,baseRefName,headRefOid,title 2>/dev/null
gh pr checks $(gh pr view --json number -q .number) 2>/dev/null
```

### CodeRabbit state (if PR exists)

```bash
PR_NUMBER=<from above>
HEAD_OID=<from above>

# Latest CR review on current HEAD
gh api "repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/pulls/$PR_NUMBER/reviews" \
  --jq "[ .[] | select(((.user.login // \"\") | test(\"^coderabbitai(\\\\[bot\\\\])?\$\"; \"i\")) and .commit_id == \"$HEAD_OID\") ] | length"

# Unresolved CR threads (use scripts/cr-threads.sh)
"${CLAUDE_PLUGIN_ROOT}/scripts/cr-threads.sh" $PR_NUMBER \
  | jq '[ .[] | select(.isResolved == false) ] | length'
```

## Report format

Print a single block. Example output:

```
thought-shower status

Branch:        feat/community-stats-endpoint
Upstream:      origin/feat/community-stats-endpoint
Working tree:  clean
Commits ahead: 5

PR:            #486 (OPEN, ready)  https://github.com/...
Base:          dev
HEAD:          ed562b12

Codex:         done (summary comment posted)  |  unknown (no comment found)
CodeRabbit:    review posted on current HEAD
  Threads:     3 unresolved
Checks:        4 PASS, 0 FAIL, 0 PENDING

Inferred next stage: Stage 4 — resolve CR threads (run /thought-shower:ship)
```

## Inferred-next-stage decision tree

| Condition | Next stage |
| --- | --- |
| No PR exists, no commits ahead | Stage 1 (run `/thought-shower:start`) |
| No PR exists, commits ahead | Stage 2 (run `/thought-shower:ship`) |
| Draft PR + base != dev | Stage 4a (waiting for base flip) |
| Draft PR + base == dev OR ready PR + no CR review on current HEAD | Stage 4b/c (CR phase) |
| CR review posted + unresolved threads > 0 | Stage 4d (resolve threads) |
| CR review posted + unresolved threads == 0 + checks not all green | Stage 5 (waiting on checks) |
| All clear | Stage 6 (merge handoff) |
| Stage detection fails (e.g., gh not authenticated) | Report the failure literally; do not guess |

**Codex detection.** Look for a PR comment whose body starts with the marker `<!-- thought-shower:codex-turn -->`:

```bash
gh api "repos/$OWNER_REPO/issues/$PR_NUMBER/comments" \
  --jq '[ .[] | select(.body | startswith("<!-- thought-shower:codex-turn -->")) ] | length'
```

If `> 0` → Codex turn done. If `0` → unknown (Codex either hasn't run, or ran but the comment wasn't posted). Report says `unknown` and recommends re-running `/ship` (Stage 3 is fast and idempotent — the comment posting will update in place if it already exists).

## Failure modes

- `gh` not authenticated → report `gh auth status failed` and stop.
- Not in a git repo → report `not a git repo` and stop.
- No upstream and no PR → report `local-only branch` and infer Stage 2.
