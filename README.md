# thought-shower

A personal Claude Code plugin bundling one engineer's software-engineering workflow — commands, skills, subagents, and an MCP bridge in one installable unit. Each piece is meant to make a real SWE task faster or more disciplined: less context-switching, fewer dropped checks, better review hygiene.

> Status: **early & evolving.** See [`CHANGELOG.md`](./CHANGELOG.md) for what landed and when. Issues and PRs welcome.

## What it gives you

Five capabilities, each built from a mix of commands, skills, subagents, and MCP tools:

- **Ship a feature end-to-end** — 6-stage pipeline from blank branch to "ready to merge", with brainstorming, Codex review, and CodeRabbit review wired in.
- **Brainstorm with discipline** — structured ideation that doesn't skip context exploration, alternatives, or section-by-section approval.
- **Reach me on Telegram** — send and receive messages + media (photos ≤10 MB, documents ≤50 MB) via an MCP bridge while away from the terminal.
- **Capture session learnings** — extract non-obvious takeaways and route them to canonical homes (gotchas, rules, memory, pitfalls).
- **Visualize on demand** — produce self-contained HTML artifacts when a rendered page beats markdown.

The plugin holds your hand only where discipline matters (no performative agreement on review feedback, verify-before-claim on every check) and gets out of the way otherwise.

## Install

Via marketplace:

```bash
/plugin marketplace add yuntian3008/yuntian3008
/plugin install thought-shower@yuntian3008
```

Or install locally:

```bash
git clone https://github.com/yuntian3008/thought-shower.git
claude --plugin-dir ./thought-shower
```

After install, verify the required dependencies (see below) are installed.

## Required dependencies

The plugin runs a preflight check on every command and fails fast if any are missing:

| Dep | Provides | Install |
| --- | --- | --- |
| [`superpowers`](https://github.com/anthropic-experimental/superpowers) | `brainstorming`, `finishing-a-development-branch`, `receiving-code-review` | `/plugin install superpowers` |
| [`codex`](https://github.com/openai/codex) | `codex:codex-rescue` agent (Stage 3) | `/plugin install codex` |

`gh` must be authenticated (`gh auth status`). CodeRabbit must be installed on the target repo — Stage 4 hard-requires it and will time out at 30 min if no review posts.

## Capabilities

### Ship a feature end-to-end

The largest capability today. Six stages, two entry points (`/start` for Stage 1, `/ship` for Stages 2–6). Idempotent — safe to re-run.

| Stage | What happens | Owner |
| --- | --- | --- |
| 1. Branch setup | Pick base branch (default `dev`), infer type+slug from description, `git switch -c <type>/<slug> <base>`, invoke brainstorming (or `brainstorming-lite` with `--lite`). Refuses on dirty tree. | `/start` |
| 2. Finishing | `superpowers:finishing-a-development-branch`; auto-derives PR title+body from branch name + commits; creates draft PR. | `/ship` |
| 3. Codex turn | Dispatches `codex:codex-rescue` once → `review-turn` triages findings → user fixes → asks "re-run on new HEAD, or move to CR?" → on move-on, posts a summary comment documenting the round so later reviewers see it. | `/ship` |
| 4. CodeRabbit turn | Parent runs base-flip + CR-existence polls. Subagent (`coderabbit-shepherd`) runs the thread-resolution loop with `review-turn` per thread + GraphQL resolve mutation. Returns `{status: 'all_resolved' \| 'head_changed' \| 'failed'}`. | `/ship` + `coderabbit-shepherd` |
| 5. Ready-to-merge | Verifies `state==OPEN`, `isDraft==false`, `baseRef==dev`, all checks green. | `/ship` |
| 6. Merge handoff | Prints a "ready to merge" summary (title, URL, status) and stops. Never auto-merges. Notifications and merge are your responsibility. | `/ship` |

### Brainstorm with discipline

- **`prompt`** — generate raw prompt material as input for brainstorming. Saves to `.prompts/`.
- **`brainstorming-lite`** — same discipline as full `superpowers:brainstorming` (context exploration, one-question-at-a-time clarification, 2–3 approaches with tradeoffs, section-by-section approval) but skips the written spec file and the `writing-plans` handoff. Used by `/start --lite`.

### Reach me on Telegram

MCP bridge backed by a long-running daemon. State lives in `~/.claude/thought-shower/telegram-bridge/` (outside the plugin cache so it survives `/plugin update`). Sessions are keyed by worktree basename.

Skills:

- **`telegram`** — first-time setup (bot token, group, topic discovery).
- **`telegram-on`** / **`telegram-off`** — start/stop receiving messages in the current session.

MCP tools (auto-loaded when the plugin is installed):

- **`send_telegram`** — post a message to your topic.
- **`ask_telegram`** — post a question and block until you reply. Free-text reply OR a media caption both work — caption becomes the answer.
- **`send_photo`** (≤10 MB) / **`send_document`** (≤50 MB) — multipart upload with a size pre-check.
- **`telegram_init`** / **`telegram_daemon`** / **`telegram_seen`** — internal lifecycle helpers.

Inbound photos and documents are downloaded to `inbox-media/<session>/` (TTL 7 days) and surfaced to the agent via an optional `media` field on the inbox JSONL line.

### Capture session learnings

**`learn`** — extract non-obvious learnings from the current session and route each to its canonical home as declared in the project's `CANONICAL.md`. If `CANONICAL.md` is missing, scaffolds one interactively. Two destinations are always available: gotchas (folder-level `AGENTS.md ## Gotchas`) and memory (the agent's built-in memory system). Typical routing also covers project rules (`.agents/rules/`) and pitfalls (`references/pitfalls.md`).

### Visualize on demand

**`visualize-as-html`** — auto-invokes when the user asks to *visualize*, *compare*, *present*, *dashboard*, *sketch*, or *walk through* something that would be richer as a rendered page than as markdown. Produces a single self-contained `.html` file in `/tmp` (inline CSS + JS + SVG, no CDN, no trackers, system fonts only, dark-mode honest) and opens it in the default browser.

Patterns come from [ThariqS/html-effectiveness](https://github.com/ThariqS/html-effectiveness) — ~20 curated artifact types (status reports, incident timelines, flowcharts, implementation plans, comparison sheets, etc.). Independent of the shipping pipeline — use any time.

## Reference

### Commands

| Command | Use |
| --- | --- |
| `/thought-shower:start [--lite] <description>` | Stage 1. Pick base, infer `<type>/<slug>`, create branch, invoke brainstorming. |
| `/thought-shower:ship` | Stages 2–6 from the current branch. Idempotent — safe to re-run. |
| `/thought-shower:thought-shower <description>` | Auto-chains `/start` then `/ship` in one session. For trivially small features only. |
| `/thought-shower:status` | Read-only state report: branch, PR, draft state, CR review state, threads, checks. Infers the next stage. |
| `/thought-shower:resume` | Detects current stage from git + GitHub, prints it, asks "continue?". |

### Skills

| Skill | Purpose |
| --- | --- |
| `brainstorming-lite` | Brainstorm with full discipline but no written spec file. |
| `prompt` | Generate raw prompt material as input for brainstorming. |
| `learn` | Route session learnings via `CANONICAL.md`. |
| `review-turn` | Shared review-feedback discipline reused by Codex (Stage 3) and CodeRabbit (Stage 4) turns. |
| `visualize-as-html` | Produce a self-contained HTML artifact. |
| `telegram` / `telegram-on` / `telegram-off` | Telegram bridge setup + per-session controls. |

### MCP tools

Provided by the bundled `mcp-server.ts` (Telegram bridge). Auto-registered via `.mcp.json` when the plugin is installed.

| Tool | Use |
| --- | --- |
| `send_telegram` | Post a message. |
| `ask_telegram` | Post a question, block until reply (free text or media caption). |
| `send_photo` | Multipart photo upload, ≤10 MB. |
| `send_document` | Multipart document upload, ≤50 MB. |
| `telegram_init` / `telegram_daemon` / `telegram_seen` | Internal lifecycle helpers. |

### Agents

| Agent | Caller | Use |
| --- | --- | --- |
| `coderabbit-shepherd` | `/ship` Stage 4 | Threads-only resolve loop. Calls `review-turn` per thread, posts replies + GraphQL resolve mutations, returns `{status}` to the parent. |

### `review-turn` — the shared review abstraction

Auto-invokes whenever any reviewer (Codex, CodeRabbit, manual) returns feedback. Wraps `superpowers:receiving-code-review` to enforce:

- Verify each finding against codebase reality before agreeing.
- No performative agreement (no "you're absolutely right!").
- Recommend per-item: `fix` / `decline` / `defer` / `clarify` / `other`.
- Present grouped by severity, collect user decisions, return them to the caller.

Reused by both the Codex turn (Stage 3) and the CodeRabbit subagent (Stage 4). Plug new reviewers (e.g., Gemini) through the same skill rather than reinventing the review flow.

## Conventions baked in

- Auto-infer branch type from the description's first verb: `add`/`build` → `feat`, `fix` → `fix`, `remove`/`delete` → `chore`, `rename`/`extract` → `refactor`, `update docs` → `docs`. Default `feat`.
- Refuse to operate on a dirty working tree (both `/start` and `/ship`).
- On non-default branch + clean tree, asks "continue or fresh?".
- Strict equality everywhere (`===` in TypeScript / `[ "$x" = "y" ]` in shell).
- Codex runs once by default; re-run is an explicit prompt at end of turn.
- CodeRabbit is hard-required at Stage 4; 30-min timeout if no review posts.
- Stage 6 is hands-off: prints a summary and stops. Nothing is auto-merged.

## Layout

```
thought-shower/
├── .claude-plugin/plugin.json         # Manifest + hard deps
├── .mcp.json                          # MCP server registration
├── mcp-server.ts                      # Telegram bridge MCP entry (Bun)
├── README.md
├── CHANGELOG.md
├── AGENTS.md                          # Repo-wide guidance for agents (canonical)
├── CLAUDE.md → AGENTS.md              # backward-compat symlink
├── CANONICAL.md                       # /learn routing table
├── commands/{start,ship,thought-shower,status,resume}.md
├── skills/{brainstorming-lite,prompt,learn,review-turn,visualize-as-html,telegram,telegram-on,telegram-off}/SKILL.md
├── agents/coderabbit-shepherd.md
├── scripts/{cr-fresh-review,cr-threads}.sh
├── scripts/telegram-bridge/           # Daemon + helpers (Bun)
├── docs/superpowers/{plans,specs}/    # Brainstorming + plan artifacts
├── .agents/rules/                     # Canonical project rules
├── .claude/rules → ../.agents/rules   # symlink
└── references/pitfalls.md             # Hard-won lessons
```

Bundled scripts are always invoked via `"${CLAUDE_PLUGIN_ROOT}/scripts/..."` so plugin updates don't break references.

## Pitfalls

The `coderabbit-shepherd` agent reads `references/pitfalls.md` on demand. Highlights:

- `gh api --jq` does NOT accept `--arg`; inline shell expansion only.
- Never `2>/dev/null` a poll command — silent failure is the worst class of bug here.
- Subagents cannot spawn other subagents; `coderabbit-shepherd` has no `Agent` tool.
- Always `KillShell` every background poll before the agent returns.

## Why "thought-shower"?

British idiom for a brainstorm — the kind that washes ideas onto the page. The plugin started as a PR-shipping pipeline; the name now covers the broader personal-workflow toolkit built around it.

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md). Entries are prepended (newest first) and grouped by date. The plugin doesn't pin versions because Claude Code marketplace updates roll out automatically — readers should treat the changelog as a continuous log, not a release notes file.

## Status & contributing

Early and evolving. Likely directions:

- More SWE workflow pieces (commands, pipelines, skills) as the personal workflow evolves.
- First-run verification of the shipping pipeline against a wider variety of real PRs.
- Optional `--skip-codex` flag on `/ship` for trivial PRs.
- Optional alternative reviewers (e.g., Gemini, internal LLM reviewers) wired through the `review-turn` skill.
- Pagination for inner comments inside CR threads (rare edge case, see `references/pitfalls.md`).

Issues and PRs welcome.
