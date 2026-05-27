import { reflex } from "@host/api";
import type { Task } from "./_types";

/**
 * Refresh the dashboard KPI card. Counts in-progress and ready tasks.
 * Called by the utility after any task write (via reflex.actions.invoke
 * from ui.tsx) and on every workflow-driven update.
 */
export default async function refreshCard(): Promise<{
  inProgress: number;
  ready: number;
}> {
  const list = (await reflex.kb.list({ kind: "task" })) ?? [];
  let inProgress = 0;
  let ready = 0;
  for (const f of list) {
    try {
      const { content } = await reflex.kb.read({ relPath: f.relPath });
      const m = /^---\n([\s\S]*?)\n---/.exec(content);
      if (!m) continue;
      const status = /status:\s*(\S+)/.exec(m[1]!)?.[1];
      if (status === "in-progress") inProgress++;
      else if (status === "ready") ready++;
    } catch {
      /* skip */
    }
  }
  await reflex.cards.update({
    snapshot: {
      kind: "kpi",
      title: "📋 Tasks",
      data: {
        items: [
          { label: "In progress", value: String(inProgress) },
          {
            label: "Ready",
            value: String(ready),
            hint: "waiting for an agent",
          },
        ],
      },
    },
  });
  return { inProgress, ready };
}
