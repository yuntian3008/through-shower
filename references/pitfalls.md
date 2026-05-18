# Pitfalls — thought-shower lessons learned

Hard-won notes from prior pr-shepherd incidents. The agent reads this file when a poll fails or it needs to debug.

## 1. `gh api --jq` does NOT accept `--arg`

**Symptom:** the poll loop reports `fresh=0` forever even after the reviewer posts.

**Root cause:** `gh api --jq <filter>` is a thin wrapper that takes only a single jq filter string. The `--arg` flag (which exists on raw `jq`) is silently rejected by `gh api`. Combine that with `2>/dev/null` and the loop has no way to detect the failure.

**Fix:** inline shell-expand variables into the filter string. Always sanity-check the call OUTSIDE the polling loop, and reject non-numeric output:

```bash
fresh=$(gh api "repos/$OWNER_REPO/pulls/$PR/reviews" --jq "$(build_filter)")
case "$fresh" in
  ''|*[!0-9]*) echo "FILTER_BROKEN: $fresh" >&2; exit 2 ;;
esac
```

The plugin's `scripts/cr-fresh-review.sh` already implements this guard.

## 2. Never `2>/dev/null` a poll command

**Symptom:** poll returns a stable wrong value forever; Monitor never trips; user sees "still waiting" notifications until the session ends.

**Root cause:** swallowing stderr makes broken commands indistinguishable from "no event yet".

**Fix:** never redirect stderr to `/dev/null` inside a poll. Let real errors surface. The sanity-check pattern above catches structural failures; let actual `gh` errors print to stderr where Monitor can see them.

## 3. Subagents cannot spawn other subagents

**Symptom (historical):** `pr-shepherd` agent dispatched `codex:codex-rescue` via the `Agent` tool, then on resume the transcript was lost ("Agent has no transcript to resume").

**Root cause:** the Claude Code subagents docs say "Subagents cannot spawn other subagents." It works only with the experimental flag `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, and even then the resume chain is fragile.

**Fix:** the `coderabbit-shepherd` agent does not have `Agent` in its tools list. Codex review is the parent's responsibility (Stage 3 of `/ship`). If a subagent feels like it needs to delegate, return a structured status to the parent and let the parent dispatch.

## 4. Always `KillShell` every background shell before the agent returns

**Symptom:** the parent keeps receiving notification noise after the subagent has returned.

**Root cause:** `Bash(run_in_background: true)` shells outlive the dispatch. If they're still running (because Monitor matched but no one terminated the shell), they keep emitting output.

**Fix:** track every background shell ID in a TodoWrite item. Stage Cleanup in the agent definition runs `KillShell` on each before the final return message. Verify with `BashOutput` that they actually terminated. If a shell won't die, include a `WARNING: shell <id> still running` line in the return so the parent isn't surprised.

## 5. Strict equality only

**Symptom:** subtle bash bugs around string comparison.

**Fix:** always `[ "$x" = "$y" ]`, never `[ "$x" == "$y" ]` (the `==` form is a bashism that fails in `/bin/sh`). For numeric, `-eq` / `-ne`. For TS/JS code in this codebase: always `===` / `!==`.

## 6. `gh api --jq` on a single GraphQL node uses `--jq` (not `-q`)

`gh api graphql -f query='...' --jq '.data...'` is correct. `gh api repos/.../reviews -q '...'` also works (alias). Don't mix them up — `gh pr view` uses `-q`, `gh api` uses `--jq`. If you see weird empty output, check which command you're using.

## 7. CodeRabbit auto-resolution is sometimes flaky

**Symptom:** user replied to a thread but `isResolved` stays `false`.

**Behavior:** CR usually auto-resolves when it sees a fix or a reply. Sometimes it doesn't. After a real user reply, wait 2 minutes; if still unresolved, the agent runs `resolveReviewThread` itself.

**Don't** auto-resolve before the 2-minute window — sometimes CR resolves and the thread state changes after; running the mutation prematurely would race.

## 8. Outdated threads need explicit user acknowledgment

`isOutdated: true` means CR's comment refers to code that's been changed/removed. Do NOT auto-treat as resolved. Surface each one to the user with file:line + URL and ask explicitly. Only after the user says "OK to ignore" does the agent run `resolveReviewThread`.

## 9. Pagination on long threads

The GraphQL query in `cr-threads.sh` paginates threads (100 per page) but currently does NOT paginate inner comments (50 per thread). If a single thread exceeds 50 comments, the `lastAuthorLogin` / `lastReplyAt` fields will reflect the 50th comment, not the actual last. Rare, but worth knowing if you ever see weird thread-state mismatches on a busy PR.

If this becomes a real problem, add a second-tier pagination loop on `comments` inside the script.

## 10. Use CodeRabbit's commit status, not reviews+comments

**Symptom (historical):** poll script reports `fresh=0` forever even after CR finishes; user sees a top-level PR comment "No actionable comments were generated in the recent review. 🎉" but our poll never trips.

**Root cause:** the `/pulls/<n>/reviews` endpoint only returns formal review objects. CR's clean-pass response is sometimes posted as an `issue_comment` (top-level PR comment) with NO entry in the reviews list. Filtering reviews by `commit_id == HEAD` will miss it forever.

**Fix (current behavior):** poll the **commit-status** endpoint instead. CR registers a GitHub commit status with `context: "CodeRabbit"` that transitions:
- `state=pending`, `description="Review in progress"` — review started
- `state=success`, `description="Review completed"` — done with findings
- `state=success`, `description="Review skipped"` — CR opted out (e.g., base ≠ dev, no diff)
- `state=failure`, `description=<error>` — CR errored

The combined-status endpoint (`/commits/<sha>/status`) returns the latest status per context, keyed on commit SHA — no timestamp gating needed. The script `scripts/cr-fresh-review.sh` uses this approach.

This is dramatically simpler than the reviews+comments approach: one API call, native HEAD anchoring, handles clean-pass and skipped cases automatically.

## 11. `\\$` in a double-quoted bash string becomes `\$`, which jq rejects

**Symptom:** `gh api ... --jq "..."` fails with `jq: error: Invalid escape '\\$'` and the calling script reports `FILTER_BROKEN` (or an empty result that we mis-handle).

**Root cause:** the markdown source had `\\$` thinking it would produce a literal `$` end-anchor inside the jq regex. Bash double-quote processing reduces `\\$` to `\$` (backslash + dollar). jq parses string literals and rejects `\$` — only `\\`, `\/`, `\"`, `\b`, `\f`, `\n`, `\r`, `\t`, `\u` are valid string escapes.

**Fix:** use **`\$`** in the source (not `\\$`). Bash sees `\$` and interprets it as an escaped `$` → produces a bare `$` for jq. jq treats `$` in a string as literal, and the regex engine reads it as the end-of-string anchor.

```
source markdown      :  test("^coderabbitai(\\\\[bot\\\\])?\$"; "i")
after bash interp    :  test("^coderabbitai(\\[bot\\])?$"; "i")
jq string content    :  ^coderabbitai(\[bot\])?$
regex engine sees    :  ^coderabbitai(\[bot\])?$         (correct end-anchor)
```

Rule of thumb: when the jq filter is in a **double-quoted** bash string (because you need `$VAR` expansion), use `\$` for a literal dollar that should reach jq. When the jq filter is in a **single-quoted** string (`'...'`, no var expansion), use a bare `$` — no escaping needed.

The single-quoted form is safer when possible; reach for double-quoted only when you actually need variable expansion in the filter.

## 12. For agent-owned polling, run the script as Monitor's command

Don't pair `Bash(run_in_background)` with `Monitor(tail -f file | grep)`. Just give Monitor the script:

```
Monitor(command='"${CLAUDE_PLUGIN_ROOT}/scripts/cr-fresh-review.sh" 488 <sha>', ...)
```

Script must print **only** terminal lines (`CR_REVIEW_POSTED`, `HEAD_CHANGED:<sha>`, …) to stdout; send progress chatter to stderr. Set `timeout_ms` slightly above the script's internal deadline so its own `*_TIMEOUT` line reaches stdout first. No `KillShell`, no output file, no init check.

Use the two-process pattern only to watch a log file someone *else* writes (test runner, server).

## 13. `gh pr view` with no PR returns non-zero, not empty

**Symptom:** trying to detect "no PR exists" by checking for empty output fails — you get a non-zero exit instead.

**Fix:** check exit code or use `2>/dev/null || true` carefully (note: this is one of the rare cases where stderr-redirect is fine — `gh pr view` writes a clean error message to stderr that we don't need to parse). For poll loops, always use commands whose stderr we DO care about.
