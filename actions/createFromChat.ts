import { reflex } from "@host/api";
import type { Task, TaskType, TaskPriority } from "./_types";

/**
 * Quick programmatic create. Lets a future slash command or an external
 * caller (e.g. a workflow node) author a task without round-tripping
 * through the iframe UI. The agent's `<<reflex:task-create>>` marker
 * goes through the core path directly — this action is for utility
 * use cases.
 */
export default async function createFromChat(args: {
  title: string;
  body?: string;
  type?: TaskType;
  priority?: TaskPriority;
  labels?: string[];
}): Promise<{ id: string }> {
  const tasksApi = reflex.tasks as unknown as {
    create: (a: {
      title: string;
      body?: string;
      type?: TaskType;
      priority?: TaskPriority;
      labels?: string[];
    }) => Promise<{ id: string }>;
  };
  return tasksApi.create({
    title: args.title,
    body: args.body ?? "",
    type: args.type ?? "feature",
    priority: args.priority ?? "normal",
    labels: args.labels ?? [],
  });
}
