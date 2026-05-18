---
description: Detect the current pipeline stage from git + GitHub state, print it, and ask the user to confirm before running the next step. Use when picking up a feature after a gap (days, sessions).
---

# /thought-shower:resume

Detect → print → ask "continue?".

## Steps

### 1. Run /status logic

Reuse the detection from `/thought-shower:status` (don't duplicate the logic — actually invoke that command's body or re-run its checks). Capture the inferred next stage.

### 2. Print and ask

Show the user:

```
thought-shower resume

Current state:
  Branch:    <branch>
  PR:        <#number or none>
  CR:        <state>

Inferred next stage: <Stage X — short description>

Continue from this stage? [yes | no | run /status only]
```

### 3. Branch on user reply

| Reply | Action |
| --- | --- |
| `yes` | Invoke the relevant sub-flow: Stage 1 → call `/thought-shower:start` (no description, ask user); Stage 2+ → call `/thought-shower:ship` |
| `no` | Stop. Print `OK. Run /thought-shower:start or /thought-shower:ship manually when ready.` |
| `run /status only` | Print full /status report and stop |

### 4. Special cases

- **Stage 6 detected** → just report `PR is ready to merge. Run /thought-shower:ship to see the merge-handoff summary.` /resume itself never prints the summary — it's only a stage detector.
- **Codex stage uncertain** → /resume cannot detect Codex state. If the next-stage detection lands on "Stage 3 or later", explicitly tell the user: `Codex run state unknown — /ship will re-run codex:rescue. To skip, you must edit /ship.md (no flag for this in v0.1).`
- **Stage detection fails** → print the failure and stop. Do not guess.
