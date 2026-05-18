# through-shower

A Claude Code plugin that walks a feature branch from "I have an idea" to "ready to merge". Six stages, three slash commands, one shared review pattern. Reuses the `superpowers` and `codex` skills rather than reinventing them.

> Status: **v0.1.0 — early.** Untested end-to-end against a real PR; the design is solid but the first run will likely surface adjustments. PRs welcome.

## What it does

```
1. Branch setup     2. Finishing          3. Codex review
4. CodeRabbit       5. Ready-to-merge     6. Merge handoff
```

Each stage has a clear exit condition. The plugin holds your hand only where the discipline matters (no performative agreement on review feedback, verify-before-claim on every check) and gets out of the way otherwise.

## Install

This plugin is not yet on the official Claude Code marketplace. Install locally:

```bash
git clone https://github.com/yuntian3008/through-shower.git
claude --plugin-dir ./through-shower
```

Or symlink into your local plugins directory and use it across sessions:

```bash
git clone https://github.com/yuntian3008/through-shower.git ~/.claude/plugins/local/through-shower
# in any Claude Code session:
/reload-plugins
```

After install, verify the required dependencies (see below) are installed.

## Required dependencies

The plugin runs a preflight check on every command and fails fast if any are missing:

| Dep | Provides | Install |
| --- | --- | --- |
| [`superpowers`](https://github.com/anthropic-experimental/superpowers) | `brainstorming`, `brainstorming-lite`, `finishing-a-development-branch`, `receiving-code-review` | `/plugin install superpowers` |
| [`codex`](https://github.com/openai/codex) | `codex:codex-rescue` agent (Stage 3) | `/plugin install codex` |

`gh` must be authenticated (`gh auth status`). CodeRabbit must be installed on the target repo — Stage 4 hard-requires it and will time out at 30 min if no review posts.

## Configuration

No user settings to configure. The plugin is hands-off at Stage 6 — it prints a "ready to merge" summary and stops. Send notifications and merge on your own.

## Commands

| Command | Use |
| --- | --- |
| `/through-shower:start [--lite] <description>` | Stage 1 only. Picks base branch, infers `<type>/<slug>`, creates the branch, invokes `superpowers:brainstorming` (or `brainstorming-lite` with `--lite`). |
| `/through-shower:ship` | Stages 2–6 from the current branch. Idempotent — safe to re-run after pushing fixes. |
| `/through-shower:auto <description>` (alias of `/through-shower:through-shower`) | Auto-chains `/start` then `/ship` in one session. For trivially small features only. The `auto` name sorts first alphabetically in the picker. Implemented as a symlink — **Windows users** must clone with `core.symlinks=true` (requires Developer Mode or admin) or this command will be broken. |
| `/through-shower:status` | Read-only state report: branch, PR, draft state, CR review state, threads, checks. Infers the next stage. |
| `/through-shower:resume` | Detects current stage from git + GitHub, prints it, asks "continue?". |

## Pipeline

| Stage | What happens | Owner |
| --- | --- | --- |
| 1. Branch setup | Pick base branch (default `dev`), infer type+slug from description, `git switch -c <type>/<slug> <base>`, invoke `superpowers:brainstorming(-lite)`. Refuses on dirty tree. | `/start` |
| 2. Finishing | `superpowers:finishing-a-development-branch`; auto-derives PR title+body from branch name + commits; creates draft PR. | `/ship` |
| 3. Codex turn | Dispatches `codex:codex-rescue` once → `review-turn` skill triages findings → user fixes → asks "re-run on new HEAD, or move to CR?" → on move-on, posts a summary comment on the PR documenting the round (findings, per-item decisions, fix commits) so CodeRabbit and human reviewers can see what Codex did. | `/ship` |
| 4. CodeRabbit turn | **Parent:** base-flip + CR-existence polls (Monitor + bash). **Subagent (`coderabbit-shepherd`):** thread-resolution loop, `review-turn` per thread, GraphQL resolve mutation. Returns `{status: 'all_resolved' \| 'head_changed' \| 'failed'}`. | `/ship` + `coderabbit-shepherd` |
| 5. Ready-to-merge | Verifies `state==OPEN`, `isDraft==false`, `baseRef==dev`, all checks green. | `/ship` |
| 6. Merge handoff | Prints a "ready to merge" summary (title, URL, status) and stops. Never auto-merges. Notifications and merge are the user's responsibility. | `/ship` |

## The `review-turn` skill

The plugin's core abstraction. Auto-invokes whenever any reviewer (Codex, CodeRabbit, manual) returns feedback. Wraps `superpowers:receiving-code-review` to enforce:

- Verify each finding against codebase reality before agreeing.
- No performative agreement (no "you're absolutely right!").
- Recommend per-item: `fix` / `decline` / `defer` / `clarify` / `other`.
- Present grouped by severity, collect user decisions, return them to the caller.

Reused by both the Codex turn (Stage 3) and the CodeRabbit subagent (Stage 4).

## Conventions baked in

- Auto-infer branch type from the description's first verb: `add`/`build` → `feat`, `fix` → `fix`, `remove`/`delete` → `chore`, `rename`/`extract` → `refactor`, `update docs` → `docs`. Default `feat`.
- Refuse to operate on a dirty working tree (both `/start` and `/ship`).
- On non-default branch + clean tree, asks "continue or fresh?".
- Strict equality everywhere (`===` in TypeScript / `[ "$x" = "y" ]` in shell).
- Codex runs once by default; re-run is an explicit prompt at end of turn.
- CodeRabbit is hard-required at Stage 4; 30-min timeout if no review posts.
- Stage 6 is hands-off: prints a summary and stops. Nothing is auto-merged. Notifications and merge are the user's responsibility.

## Layout

```
through-shower/
├── .claude-plugin/plugin.json
├── README.md
├── commands/{auto,start,ship,through-shower,status,resume}.md
├── skills/review-turn/SKILL.md
├── agents/coderabbit-shepherd.md
├── scripts/{cr-fresh-review,cr-threads}.sh
└── references/pitfalls.md
```

Scripts are bundled assets — always invoked via `"${CLAUDE_PLUGIN_ROOT}/scripts/..."` so plugin updates don't break references.

## Pitfalls

The `coderabbit-shepherd` agent reads `references/pitfalls.md` on demand. Highlights:

- `gh api --jq` does NOT accept `--arg`; inline shell expansion only.
- Never `2>/dev/null` a poll command — silent failure is the worst class of bug here.
- Subagents cannot spawn other subagents; the `coderabbit-shepherd` agent has no `Agent` tool.
- Always `KillShell` every background poll before the agent returns.

## Why "through-shower"?

A play on "PR shepherd" — but the agent washes the PR through a pipeline rather than herding it. Also disambiguates from any other `pr-shepherd` in your `~/.claude/agents/`.

## Status & roadmap

v0.1.0 ships the design end-to-end but has not been battle-tested. Likely v0.2 work:

- Verified first-run report on a real PR.
- Optional `--skip-codex` flag on `/ship` for trivial PRs.
- Optional alternative reviewers (e.g., Gemini, internal LLM reviewers) plug into the `review-turn` skill.
- Pagination for inner comments inside CR threads (rare edge case, see `references/pitfalls.md` #9).

Issues and PRs welcome.
