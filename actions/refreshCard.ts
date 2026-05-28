import { reflex } from "@host/api";
import { TASK_STATUSES, type TaskStatus } from "./_types";

interface CardSnapshot {
  kind: "kpi";
  title: string;
  data: { items: Array<{ label: string; value: string; hint?: string }> };
}

/**
 * Build the dashboard KPI card from live task data.
 *
 * Returns the snapshot so Reflex core can write it (the dashboard calls
 * this action on view + on cadence). Also pushes it via
 * `reflex.cards.update` so the older path — ui.tsx invoking this after a
 * write — keeps working without a reinstall.
 */
export default async function refreshCard(): Promise<CardSnapshot> {
  const counts: Record<TaskStatus, number> = {
    backlog: 0,
    ready: 0,
    "in-progress": 0,
    review: 0,
    done: 0,
    blocked: 0,
  };

  const list = (await reflex.kb.list({ kind: "task" })) ?? [];
  for (const f of list) {
    try {
      const { content } = await reflex.kb.read({ relPath: f.relPath });
      const m = /^---\n([\s\S]*?)\n---/.exec(content);
      if (!m) continue;
      const status = /status:\s*(\S+)/.exec(m[1]!)?.[1] as
        | TaskStatus
        | undefined;
      if (status && TASK_STATUSES.includes(status)) counts[status]++;
    } catch {
      /* skip unreadable */
    }
  }

  const items: CardSnapshot["data"]["items"] = [
    { label: "Backlog", value: String(counts.backlog) },
    { label: "Ready", value: String(counts.ready) },
    { label: "In progress", value: String(counts["in-progress"]) },
    { label: "Done", value: String(counts.done) },
  ];
  if (counts.blocked > 0) {
    items.push({ label: "Blocked", value: String(counts.blocked) });
  }
  const snapshot: CardSnapshot = {
    kind: "kpi",
    title: "📋 Tasks",
    data: { items },
  };

  // Back-compat: push the snapshot so the in-UI invoke path still updates
  // the card. Core also writes the returned value — harmless double write.
  await reflex.cards.update({ snapshot });

  return snapshot;
}
