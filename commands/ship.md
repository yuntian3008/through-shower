---
description: Stages 2–6 of through-shower. From a branch with committed code, run finishing → Codex review → CodeRabbit review → ready-to-merge → ask user to ping Mike or end. Idempotent — safe to re-run.
---

# /through-shower:ship

Run **Stages 2–6** of the through-shower pipeline.

## Preflight (fail fast)

Verify required dependencies are loaded. If ANY missing, stop and report (same message as /start preflight):

- skill `superpowers:finishing-a-development-branch`
- skill `superpowers:receiving-code-review`
- agent `codex:codex-rescue`
- skill `send-slack-message` (only used at Stage 6, but check early)

Also verify `gh auth status` succeeds.

## Working-tree check (refuse-on-dirty)

Run `git status --porcelain`. If output is non-empty, **stop** and tell the user:

```
Working tree has uncommitted changes. Commit or stash before /ship —
uncommitted changes will NOT be in the PR.
<git status output>
```

Do NOT auto-stash. Same rule as `/start`.

## Re-derive context

The user may have invoked /ship in a fresh session. Read state from git:

```bash
FEATURE_BRANCH=$(git branch --show-current)
RECORDED_BASE=$(gh pr view --json baseRefName -q .baseRefName 2>/dev/null || echo "")
```

If a draft PR already exists for the branch, use its `baseRefName` as `RECORDED_BASE`. Otherwise default to `dev` (and warn the user — they may have intended a different base).

If the branch has no commits ahead of base, stop:

```
No commits ahead of <base>. Nothing to ship.
```

## Stage 2 — Finishing (PR creation)

Use the `Skill` tool to invoke `superpowers:finishing-a-development-branch`. Pass these instructions explicitly:
- **Preselect Option 2** (Push and Create PR).
- Pass `--base <RECORDED_BASE>` and `--draft` to the `gh pr create` command.
- Auto-derive title and body — do NOT prompt the user:
  - **Title**: derive from branch name. `feat/add-user-auth` → `feat: add user auth`. Replace `/` with `: `, replace `-` in slug with spaces.
  - **Body**: list commit subjects on the branch (`git log --format='- %s' <RECORDED_BASE>..HEAD`). Wrap in a `## Summary` section. Append a `## Test plan` section with a single TODO line (`- [ ] manual verify`).

If a draft PR already exists, skip Stage 2 (idempotent re-run). Capture the PR number for later stages:

```bash
PR_NUMBER=$(gh pr view --json number -q .number)
```

## Stage 3 — Codex turn (default 1 round)

1. Capture starting HEAD: `HEAD_AT_CODEX_START=$(gh pr view "$PR_NUMBER" --json headRefOid -q .headRefOid)`.
2. Use the `Agent` tool to dispatch `codex:codex-rescue`:
   - `subagent_type: "codex:codex-rescue"`
   - prompt: `Review the diff of PR #<PR_NUMBER> against base <RECORDED_BASE>. Report findings grouped by severity.`
3. When `codex:codex-rescue` returns, the findings text is the agent's final message.
4. Invoke the `Skill` tool with `through-shower:review-turn` and pass `{reviewer: "codex", findings: <agent output>}`. The skill will:
   - Apply `superpowers:receiving-code-review` discipline (verify before agreeing).
   - Group by severity, present per-item recommendations to the user.
   - Wait for user decisions (fix / decline / defer / other) per item.
5. User addresses what they want, pushes any commits.
6. **Re-run prompt** (always offer):

   Ask the user:
   ```
   Codex turn complete. Re-run codex:rescue on the new HEAD, or move to CodeRabbit?
   [re-run | move-on]
   ```

   - `re-run`: capture new HEAD, dispatch `codex:codex-rescue` again, repeat steps 3–6.
   - `move-on`: proceed to Stage 4.

## Stage 4 — CodeRabbit turn (hybrid)

The CR phase loops until either all threads are resolved or a failure is reported.

### 4a. Base-branch gate

Read current `baseRefName`. If not `dev`:
- Tell the user once: `PR is based on <base>. Waiting for base to flip to dev.`
- Start a background bash with `Bash(run_in_background: true)` polling every 60s. Track the shell ID.
- Sanity check OUTSIDE the loop first (fail loud if `gh pr view` returns empty):
  ```bash
  base=$(gh pr view <number> --json baseRefName -q .baseRefName)
  [ -z "$base" ] && echo "READ_BROKEN: empty baseRefName" >&2 && exit 1
  ```
- Background loop:
  ```bash
  while true; do
    base=$(gh pr view <number> --json baseRefName -q .baseRefName)
    echo "[$(date -u +%H:%M:%SZ)] base=$base"
    [ "$base" = "dev" ] && echo "BASE_IS_DEV" && break
    sleep 60
  done
  ```
- Use the `Monitor` tool on the shell, pattern `BASE_IS_DEV`. No upper-bound timeout.
- When matched, `KillShell` the poll.

### 4b. Mark ready + capture HEAD

```bash
HEAD_OID=$(gh pr view <number> --json headRefOid -q .headRefOid)
isDraft=$(gh pr view <number> --json isDraft -q .isDraft)
[ "$isDraft" = "true" ] && JUST_MARKED_READY=1 && gh pr ready <number>
```

### 4c. Existing-review short-circuit

Before starting a timed poll, check whether CodeRabbit has **already** reviewed the current HEAD. If yes, skip the poll — the review exists; no new one is coming.

```bash
OWNER_REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
existing=$(gh api "repos/$OWNER_REPO/pulls/<PR_NUMBER>/reviews" \
  --jq "[ .[] | select(((.user.login // \"\") | test(\"^coderabbitai(\\\\[bot\\\\])?\\$\"; \"i\")) and .commit_id == \"$HEAD_OID\") ] | length")
case "$existing" in
  ''|*[!0-9]*) echo "FILTER_BROKEN: $existing" >&2; exit 1 ;;
esac
```

- If `existing > 0` → CR already reviewed this HEAD. Skip the poll, proceed to 4e.
- If `existing == 0` AND `JUST_MARKED_READY` was set OR HEAD changed since last loop iteration → set `READY_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)` and run the timed poll below.
- If `existing == 0` AND no `JUST_MARKED_READY` AND HEAD is unchanged → unusual case (review was deleted? PR re-opened?). Set `READY_AT` to now and run the timed poll.

### 4d. CR-existence timed poll (hard 30-min cap)

Run `"${CLAUDE_PLUGIN_ROOT}/scripts/cr-fresh-review.sh" <PR_NUMBER> <HEAD_OID> <READY_AT>` in a background shell. Track the shell ID. (Always wrap `${CLAUDE_PLUGIN_ROOT}` in double quotes — the path may contain spaces.)

The script writes `CR_REVIEW_POSTED`, `CR_TIMEOUT`, or `FILTER_BROKEN` on its last line.

Use `Monitor` on the shell, pattern `CR_REVIEW_POSTED|CR_TIMEOUT|FILTER_BROKEN`.

- `CR_REVIEW_POSTED` → `KillShell`, proceed to 4e.
- `CR_TIMEOUT` → stop the whole pipeline. Report: `CodeRabbit did not post a review within 30 min — verify the CodeRabbit GitHub App is installed on this repo. CR is hard-required at Stage 4.`
- `FILTER_BROKEN` → stop. Report stderr from the script. See `references/pitfalls.md`.

### 4e. Dispatch coderabbit-shepherd subagent

Use the `Agent` tool:
- `subagent_type: "coderabbit-shepherd"`
- prompt: `Resolve all CodeRabbit threads on PR #<PR_NUMBER>. Starting HEAD: <HEAD_OID>. Return {status, ...} per the agent's contract.`

The subagent returns one of:
- `{status: "all_resolved"}` → proceed to Stage 5.
- `{status: "head_changed", newOid: "<sha>"}` → user pushed new commits. Set `HEAD_OID=<newOid>`, clear `JUST_MARKED_READY`, return to 4c (re-check existing review first, then poll if needed).
- `{status: "failed", reason: "<text>"}` → surface to user, stop.

## Stage 5 — Ready-to-merge gate

Re-verify all conditions in this turn (do not rely on memory):

```bash
gh pr view <number> --json state,isDraft,baseRefName
gh pr checks <number>
```

All must hold:
- `state == "OPEN"`
- `isDraft == false`
- `baseRefName == "dev"`
- Every check row is PASS or SKIPPING (no FAIL, no PENDING)

If any condition fails, surface to the user with a recommended next action and stop.

## Stage 6 — Merge handoff

Read the configured Slack recipient. Source: plugin `userConfig.slack_recipient`, exposed as the env var `CLAUDE_PLUGIN_OPTION_SLACK_RECIPIENT`. Empty means "no recipient configured".

```bash
RECIPIENT="${CLAUDE_PLUGIN_OPTION_SLACK_RECIPIENT:-}"
```

### If `RECIPIENT` is non-empty

Ask the user:

```
PR ready to merge.
[1] Slack ping <RECIPIENT>
[2] End (you'll merge yourself)
```

If `1`:
- Compose the message:
  - Line 1: PR title verbatim (`gh pr view <number> --json title -q .title`).
  - Line 2: first non-empty line of body (`gh pr view <number> --json body -q .body | sed -n '/./{p;q;}'`). Skip if body is empty.
  - Line 3: PR URL.
  - Line 4: `CodeRabbit clean, all checks green — ready to merge.`
- Use the `Skill` tool to invoke `send-slack-message` with recipient `<RECIPIENT>` (the skill resolves it against its own `recipients.md`). If the recipient is not in `recipients.md`, the skill will fail with a clear error — surface it to the user.
- Confirm send to user.

If `2`: print `Pipeline complete. Merge when ready.` and stop.

### If `RECIPIENT` is empty

Just announce:

```
PR ready to merge. Merge when ready.
(Configure `slack_recipient` in plugin settings to enable the Slack ping option.)
```

Then stop.

### Always

Do NOT merge the PR yourself. Ever.

## Idempotency notes

- Stage 2 is a no-op if the draft PR already exists.
- Stage 3 always runs at least once per /ship invocation. To skip Codex on a re-run, the user passes `--skip-codex` (TODO: not in v0.1).
- Stage 4 re-runs base-flip + CR poll if base or HEAD changed; otherwise skips to subagent dispatch.
- Stage 5 is pure read.
- Stage 6 always asks; never auto-pings.
