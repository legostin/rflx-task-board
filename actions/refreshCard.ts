import { reflex } from "@host/api";
import type { Task } from "./_types";

interface ActionListItem {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  action?: { label: string; actionName: string };
}
interface ActionListSnapshot {
  kind: "action-list";
  title: string;
  data: { groups: Array<{ label: string; emptyText?: string; items: ActionListItem[] }> };
}

const MAX_BACKLOG = 5;
const MAX_IN_PROGRESS = 5;

/**
 * Build the dashboard card: a few backlog tasks (each with a Send-to-
 * agent button), what's currently in progress, and the most recently
 * finished task. Returns the snapshot for Reflex core to write; also
 * pushes it via reflex.cards.update so the in-UI invoke path still works.
 */
export default async function refreshCard(): Promise<ActionListSnapshot> {
  const { tasks } = (await reflex.tasks.list()) as { tasks: Task[] };

  const backlog = tasks
    .filter((t) => t.status === "backlog")
    .slice(0, MAX_BACKLOG)
    .map((t) => ({
      id: t.id,
      title: t.title,
      badge: t.type,
      action: { label: "Send to agent", actionName: "dispatchFromCard" },
    }));

  const inProgress = tasks
    .filter((t) => t.status === "in-progress")
    .slice(0, MAX_IN_PROGRESS)
    .map((t) => ({
      id: t.id,
      title: t.title,
      badge: t.type,
      subtitle: "running",
    }));

  const lastDone = tasks
    .filter((t) => t.status === "done")
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 1)
    .map((t) => ({
      id: t.id,
      title: t.title,
      badge: "done",
    }));

  const snapshot: ActionListSnapshot = {
    kind: "action-list",
    title: "📋 Tasks",
    data: {
      groups: [
        {
          label: "Backlog",
          emptyText: "backlog is clear",
          items: backlog,
        },
        {
          label: "In progress",
          emptyText: "nothing running",
          items: inProgress,
        },
        {
          label: "Last completed",
          emptyText: "nothing finished yet",
          items: lastDone,
        },
      ],
    },
  };

  await reflex.cards.update({ snapshot });
  return snapshot;
}
