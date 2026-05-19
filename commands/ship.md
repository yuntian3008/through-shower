---
description: Stages 2–6 of thought-shower. From a branch with committed code, run finishing → Codex review → CodeRabbit review → ready-to-merge → handoff. Idempotent — safe to re-run.
---

# /thought-shower:ship

Run **Stages 2–6** of the thought-shower pipeline.

## Preflight (fail fast)

Verify required dependencies are loaded. If ANY missing, stop and report (same message as /start preflight):

- skill `superpowers:finishing-a-development-branch`
- skill `superpowers:receiving-code-review`
- agent `codex:codex-rescue`

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
4. Invoke the `Skill` tool with `thought-shower:review-turn` and pass `{reviewer: "codex", findings: <agent output>}`. The skill will:
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
   - `move-on`: proceed to step 7.

7. **Post the Codex-turn summary comment on the PR.** Use the HTML marker so the comment is identifiable on re-runs. Compose the body from the FINAL round only (re-runs supersede earlier rounds):

   ```
   <!-- thought-shower:codex-turn -->

   ## 🤖 Codex review turn

   Reviewed against base `<RECORDED_BASE>` at `<HEAD_AT_CODEX_START_SHORT>` → final HEAD `<CURRENT_HEAD_SHORT>`.

   **Findings: <N> actionable**

   | File:Line | Severity | Decision | Note |
   | --- | --- | --- | --- |
   | src/foo.ts:42 | high | fix | Fixed in `<sha-short>` |
   | src/bar.ts:10 | medium | decline | `<user's short reason>` |
   | ... | ... | ... | ... |

   **Commits pushed during this turn:** `<sha-short>`, `<sha-short>` (if any)

   ---
   *Posted by thought-shower.*
   ```

   Rules:
   - If the final round had **0 findings**, post a one-liner: `Codex reviewed `<sha-short>` — no actionable findings.` (still with the HTML marker)
   - The `<sha-short>` values use `git rev-parse --short=8 <sha>` so they're stable links.
   - Commits-pushed list = `git log --format='%h' <HEAD_AT_CODEX_START>..<CURRENT_HEAD>`.
   - If a Codex-turn comment with the `<!-- thought-shower:codex-turn -->` marker already exists on this PR (e.g., user re-ran /ship), **update it** with the new body instead of posting a duplicate:
     ```bash
     existing=$(gh api "repos/$OWNER_REPO/issues/$PR_NUMBER/comments" \
       --jq '[ .[] | select(.body | startswith("<!-- thought-shower:codex-turn -->")) ][0].id // empty')
     if [ -n "$existing" ]; then
       gh api -X PATCH "repos/$OWNER_REPO/issues/comments/$existing" -f body="$BODY"
     else
       gh pr comment "$PR_NUMBER" --body "$BODY"
     fi
     ```

8. Proceed to Stage 4.

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
[ "$isDraft" = "true" ] && gh pr ready <number>
```

### 4c. Wait for CR commit status

Check CR's commit status on the current HEAD:

```bash
OWNER_REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
cr_state=$(gh api "repos/$OWNER_REPO/commits/$HEAD_OID/status" \
  --jq '(.statuses // []) | map(select(.context == "CodeRabbit")) | (first // null) | (.state // "<none>")')
case "$cr_state" in
  ''|*[!a-z\<\>]*) echo "FILTER_BROKEN: $cr_state" >&2; exit 1 ;;
esac
```

- `success` → CR has finished. Proceed to 4d.
- `failure` → surface and stop.
- `pending` or `<none>` → poll until resolved (see below).

**Poll (hard 30-min cap):**

```
Monitor(
  command='"${CLAUDE_PLUGIN_ROOT}/scripts/cr-fresh-review.sh" <PR_NUMBER> <HEAD_OID>',
  description='CR review on PR #<PR_NUMBER> HEAD <HEAD_OID_SHORT>',
  timeout_ms=1900000,
  persistent=false
)
```

`timeout_ms` sits just above the script's internal 30-min deadline so its own `CR_TIMEOUT` line lands on stdout first. Wrap `${CLAUDE_PLUGIN_ROOT}` in double quotes — path may contain spaces.

The Monitor event will contain one of:

- `CR_REVIEW_POSTED` → proceed to 4d.
- `CR_REVIEW_FAILED: <description>` → stop, report.
- `CR_TIMEOUT` → stop. Report: `CodeRabbit did not post a status within 30 min — verify the CodeRabbit GitHub App is installed and active on this repo.`
- `FILTER_BROKEN: ...` → stop. Re-run the script in foreground for the error text. See `references/pitfalls.md`.

### 4d. Thread check

After CR finishes (regardless of commit-status value), count unresolved threads:

```bash
UNRESOLVED=$("${CLAUDE_PLUGIN_ROOT}/scripts/cr-threads.sh" "$PR_NUMBER" \
  | jq '[ .[] | select(.isResolved == false) ] | length')
```

- `UNRESOLVED === 0` → no threads to resolve, skip 4e, proceed to Stage 5.
- `UNRESOLVED > 0` → proceed to 4e.

### 4e. Dispatch coderabbit-shepherd subagent

Use the `Agent` tool:
- `subagent_type: "coderabbit-shepherd"`
- prompt: `Resolve all CodeRabbit threads on PR #<PR_NUMBER>. Starting HEAD: <HEAD_OID>. Return {status, ...} per the agent's contract.`

The subagent returns one of:
- `{status: "all_resolved"}` → proceed to Stage 5.
- `{status: "head_changed", newOid: "<sha>"}` → user pushed new commits. Set `HEAD_OID=<newOid>`, return to 4c (re-check status short-circuit first, then poll if needed).
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

Print a short summary and stop:

```
PR ready to merge.
  Title:  <gh pr view <number> --json title -q .title>
  URL:    <gh pr view <number> --json url -q .url>
  Status: CodeRabbit clean, all checks green.

Merge when ready.
```

Do NOT merge the PR yourself. Ever. The plugin is hands-off at this stage — notification + merge is the user's call.

## Idempotency notes

- Stage 2 is a no-op if the draft PR already exists.
- Stage 3 always runs at least once per /ship invocation.
- Stage 4 re-runs base-flip + CR poll if base or HEAD changed; thread check always runs before deciding whether to dispatch the shepherd.
- Stage 5 is pure read.
- Stage 6 only prints the ready-to-merge summary.
