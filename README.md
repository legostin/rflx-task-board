# 📋 Task Board — Reflex utility

Built-in Kanban tracker. Drop a card on the board, drag through your columns, and when you're ready, send to an agent — Reflex spins up a dedicated git worktree for code tasks so parallel work never collides. The agent commits to its own branch; you merge (or open a PR) when it's done.

## What you get

- **Kanban board** with six columns: Backlog · Ready · In progress · Review · Done · Blocked
- **Task types** — feature, bug, refactor, docs, chore, research, review, call, idea — each with its own colour, its own default skill, and a flag for whether dispatch spins a git worktree
- **Drag and drop** between columns; double-click to edit
- **Live status on cards** in progress — last assistant line + red badge when the agent needs you
- **Slash commands** the utility brings:
  - `/task <title>` — file a card from any chat
  - `/tasks [filter]` — summarise the board in chat
  - `/take-task [id]` — dispatch next ready task (auto-picks highest priority if no id)
- **Auto-pickup** (off by default) — toggle in settings + supply a strategy prompt; a workflow tick scans the `ready` column every N minutes and dispatches one
- **Pre/post hooks** per task — run a workflow before the agent starts or after they finish (e.g. regenerate docs)
- **PR mode** — when `gh` CLI is configured, the "Merge" button becomes "Open PR" for code tasks
- **Worktree cleanup** — auto-prunes merged worktrees; configurable manual prune

## Storage

Tasks live as KB entries (`kind: "task"`) inside the Space's `.reflex/task/` folder. Frontmatter holds structured fields; the body is freeform markdown for context and criteria. This means every task is searchable from the KB sidebar, links work, and `git log` over `.reflex/` is your task audit trail.

## Requires

- Reflex ≥ 0.9.0 (host API surfaces `reflex.tasks.*` + `reflex.git.worktree.*`)
- `git` on PATH for worktree mode
- Optional: `gh` CLI for PR mode
