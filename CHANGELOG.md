# Changelog

Continuous log of changes to thought-shower. Newest entries first.
Plugin updates automatically via the marketplace — there are no version pins.
Categories follow [Conventional Commits](https://www.conventionalcommits.org/) types.

## 2026-05-28

- **feat(ship)**: Stage 3 now dispatches a new `thought-shower:codex-reviewer` agent that wraps `codex-companion.mjs review` (read-only) instead of `codex:codex-rescue` (write-capable task mode); right semantics for review, no behavior change to the triage flow

## 2026-05-23

- **docs**: rewrite README capability-first; add CHANGELOG.md and doc-sync rule to AGENTS.md
- **docs**: add `CANONICAL.md` to route `/learn` output to gotchas / rules / memory / pitfalls
- **feat(mcp-server)**: `send_photo` (≤10 MB) and `send_document` (≤50 MB) tools with size pre-check (#1)
- **feat(telegram-bridge)**: inbound photos/documents downloaded to `inbox-media/<session>/` with 7-day GC; daemon surfaces media on the inbox JSONL line (#1)
- **feat(telegram-bridge)**: when an `ask_telegram` question is pending, the caption on a media reply becomes the answer (#1)
- **fix(telegram-bridge)**: switch parse mode to MarkdownV2 with escaping

## 2026-05-22

- **feat(telegram-bridge)**: `ask_telegram` interactive question tool; resolves via free-text reply or media caption
- **feat(telegram-bridge)**: GC orphan pending questions via pid liveness
- **fix(telegram-bridge)**: require explicit `session` param; remove global active session state
- **docs**: rename `CLAUDE.md` to `AGENTS.md` with backward-compat symlink
- **chore(rules)**: add canonical project rules at `.agents/rules/` with `.claude/rules` symlink
- **chore(types)**: add `tsconfig.json` and tighten `mcp-server.ts` types
