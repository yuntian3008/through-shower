---
name: telegram
description: "Start Telegram bridge for this session. Creates a topic in the Telegram group (named after the current worktree), starts the background daemon if needed, and opens a Monitor on the inbox so incoming messages appear in real time. Replies go back to the topic via the send command."
---

# Telegram Bridge Session

Connect this Claude Code session to a Telegram topic for bidirectional messaging.

## Prerequisites

- Bot and group configured: `bun ~/wp/plugins/thought-shower/scripts/telegram-bridge/cli.ts setup --token <T> --group <G> --user <U>`

## Steps

1. **Check daemon** — run `bun ~/wp/plugins/thought-shower/scripts/telegram-bridge/cli.ts daemon status`. If not running, run `bun ~/wp/plugins/thought-shower/scripts/telegram-bridge/cli.ts daemon start`.

2. **Derive session name** — run `basename $(git rev-parse --show-toplevel)` to get the worktree name.

3. **Init session** — run `bun ~/wp/plugins/thought-shower/scripts/telegram-bridge/cli.ts init --name <worktree-name>`. This creates a Telegram topic if one doesn't exist, or reuses the existing one.

4. **Ensure inbox file exists** — run `touch ~/.claude/thought-shower/telegram-bridge/inbox/<worktree-name>.jsonl` (sanitize the name: replace non-alphanumeric chars except `-` and `_` with `_`).

5. **Check for existing Monitor** — run `pgrep -f "tail -f.*<worktree-name>.jsonl"`. If a process is found, another session is already monitoring this inbox. Skip steps 6 and 7 — you can still send replies via step 8 but will not receive messages (the other session handles that). Tell the user: "Another session is already monitoring Telegram for this worktree. This session can send but not receive."

6. **Clear inbox** — run `> ~/.claude/thought-shower/telegram-bridge/inbox/<worktree-name>.jsonl` to start fresh. Only reached when no existing Monitor was found in step 5.

7. **Start Monitor** — use the Monitor tool on: `tail -f ~/.claude/thought-shower/telegram-bridge/inbox/<worktree-name>.jsonl`

8. **Handle incoming messages** — each Monitor notification is a JSON line:
   ```json
   {"from":"Thien","text":"message here","ts":1716388800,"messageId":42}
   ```
   Read the message, understand it in the context of the current project, and respond helpfully.

9. **Send replies** — use the `send_telegram` MCP tool with the reply text. This is the preferred method. Fallback if the MCP tool is unavailable:
   ```bash
   bun ~/wp/plugins/thought-shower/scripts/telegram-bridge/cli.ts send <reply text>
   ```
