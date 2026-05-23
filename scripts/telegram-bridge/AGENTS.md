# scripts/telegram-bridge

Implements the Telegram bridge daemon and its supporting modules. The daemon polls the Telegram Bot API and routes messages into the Claude Code session via filesystem IPC.

## Key files

| File | Purpose |
|------|---------|
| `daemon.ts` | Long-running poll loop; dispatches incoming messages to session inboxes |
| `store.ts` | All filesystem paths and IO helpers (config, sessions, inbox JSONL, media, pending questions, responses) |
| `telegram.ts` | Thin Telegram Bot API client (sendMessage, getUpdates, etc.) |
| `markdown.ts` | MarkdownV2 escaping for outgoing messages |
| `cli.ts` | `bun cli.ts` commands: `setup`, `start`, `stop`, `status` |
| `store.spec.ts` | Unit tests for store helpers (sanitizeFilename, mediaPath, gcInboxMedia) |
| `telegram.spec.ts` | Unit tests for TelegramBot (getFile, downloadFile, sendPhoto, sendDocument) |

## State layout (lives outside plugin cache)

```
~/.claude/thought-shower/telegram-bridge/
  config.json         # bot token, group id, bot id, allowed user id
  sessions.json       # worktree name → { topicId, topicName, createdAt }
  active              # current session name (plain text)
  offset              # last processed Telegram update id
  daemon.pid          # PID of running daemon
  inbox/<sess>.jsonl  # buffered incoming messages (capped at 100 lines)
  inbox-media/<sess>/ # downloaded photo/document files (GC'd after 7 days)
  pending/<id>.json   # ask_telegram questions waiting for user reply
  responses/<id>.json # completed ask_telegram answers
```

## Patterns and conventions

- `sanitize(name)` (private) normalises session names to `[a-zA-Z0-9_-]` — used for all session-keyed paths.
- `sanitizeFilename(name)` (exported) strips `/`, `\`, null bytes, and leading dots from user-supplied Telegram filenames — used by `mediaPath` to prevent path traversal.
- `mediaPath(sessionName, messageId, ext?, filename?)` returns the full path for a downloaded media file without touching the filesystem; call `ensureMediaDir` first when writing.
- `gcInboxMedia(ttlMs)` is best-effort: per-file errors are silently swallowed so one bad entry never blocks the rest.
- Dynamic `import("node:fs/promises")` is used in places where the symbol isn't needed at module load time (GC, pending/response helpers); static `mkdir` import covers the hot path.
- `TelegramBot.getFile(fileId)` returns `{ file_id, file_path? }` — call this first, then pass the returned `file_path` to `downloadFile`.
- `TelegramBot.downloadFile(filePath, destPath)` derives the download URL by replacing `/bot` with `/file/bot` in the stored base URL — the Telegram file endpoint is different from the method endpoint.
- `TelegramBot.sendPhoto` and `TelegramBot.sendDocument` post multipart via `buildMediaForm` (builds the `FormData`) and `callForm` (POSTs and throws on `!ok`).
- `buildMediaForm` materialises `BunFile` bytes into a `File` object to preserve the filename — Bun's `FormData.append` ignores the third arg for `BunFile`.
- `TgMessage` carries `caption?`, `photo?: PhotoSize[]`, and `document?: TgDocument` for multimedia messages. `PhotoSize` and `TgDocument` are exported interfaces.
