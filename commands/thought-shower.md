---
description: Auto-chains /thought-shower:start then /thought-shower:ship in a single session. Use only for trivially small features where brainstorming, execution, and shipping all happen in one sitting. For multi-day features, use /start and /ship separately.
---

# /thought-shower $ARGUMENTS

Single-command shortcut: run `/thought-shower:start` and immediately `/thought-shower:ship` in the same session.

**Use only for trivially small features.** Brainstorming + execution + review + merge in one sitting. For anything that spans days, use `/start` and `/ship` as separate commands.

## Steps

1. Invoke `/thought-shower:start $ARGUMENTS` (the `--lite` flag, if present in `$ARGUMENTS`, is forwarded).
2. When `/start` returns control (brainstorming + execution finish), check the working tree:
   - At least one commit exists ahead of the recorded base — else stop and report `No code committed; nothing to ship.`
3. Invoke `/thought-shower:ship`.

That's it. No additional logic — both subcommands handle their own preflight, idempotency, and prompts.

## When NOT to use this

- Feature requires multi-session execution (you'll close and reopen the chat).
- You want a checkpoint between brainstorming and shipping (e.g., to review the diff manually).
- The brainstorming output suggests scope is too large for one sitting — `superpowers:brainstorming` will tell you to decompose, in which case stop here and use `/start` per sub-feature.
