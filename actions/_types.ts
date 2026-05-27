/**
 * Mirror of the Task type from reflex-agent core
 * (`lib/server/tasks/types.ts`). The utility bundles its own copy so
 * the iframe doesn't have to bounce a round-trip just for type info —
 * the host returns plain JSON via `reflex.tasks.list / get`.
 */

export const TASK_TYPES = [
  "feature",
  "bug",
  "refactor",
  "docs",
  "chore",
  "research",
  "review",
  "call",
  "idea",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = [
  "backlog",
  "ready",
  "in-progress",
  "review",
  "done",
  "blocked",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface TaskWorktree {
  dir: string;
  branch: string;
  baseRef: string;
}

export interface TaskHookRef {
  kind: "workflow" | "chat";
  id?: string;
  prompt?: string;
}

export interface TaskAttachment {
  kind: "image" | "text" | "file";
  file: string;
  caption?: string;
}

export interface TaskLinks {
  blocks?: string[];
  blockedBy?: string[];
  related?: string[];
}

export interface Task {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  labels: string[];
  assignee: string | null;
  createdAt: string;
  updatedAt: string;
  topicId: string | null;
  agentRequested: string | null;
  worktree: TaskWorktree | null;
  links: TaskLinks;
  parent: string | null;
  pre: TaskHookRef[];
  post: TaskHookRef[];
  attachments: TaskAttachment[];
  relPath: string;
  body: string;
}

export const TYPE_DEFAULTS: Record<
  TaskType,
  { isCode: boolean; defaultSkill?: string }
> = {
  feature: { isCode: true },
  bug: { isCode: true, defaultSkill: "deep-research" },
  refactor: { isCode: true },
  docs: { isCode: true },
  chore: { isCode: true },
  research: { isCode: false, defaultSkill: "deep-research" },
  review: { isCode: true },
  call: { isCode: false },
  idea: { isCode: false },
};
