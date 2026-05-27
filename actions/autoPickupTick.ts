import { reflex } from "@host/api";
import type { Task } from "./_types";

/**
 * Auto-pickup tick. Reads the user's `task-board-auto-pickup` settings
 * from secrets storage, applies the LLM-evaluated pickup prompt against
 * the `ready` column, and dispatches one task at a time.
 *
 * Designed to be wired into a Reflex workflow on a schedule
 * (every N minutes). Currently the utility's settings UI registers
 * the workflow when the toggle is on.
 */

interface PickupSettings {
  enabled: boolean;
  prompt: string;
}

const DEFAULT_PROMPT = `You are deciding which task an agent should pick up next.

Inputs you'll see:
  - READY: array of tasks waiting to be worked on
  - IN_PROGRESS: tasks already being worked on

Pick ONE task (or none). Priorities: high > normal > low. Within a tier, the oldest createdAt wins. Skip tasks whose code areas obviously overlap with something IN_PROGRESS.

Reply with strict JSON: {"taskId": "<id-or-null>", "reason": "<one-line why>"}.`;

const tasksApi = reflex.tasks as unknown as {
  list: () => Promise<{ tasks: Task[] }>;
  dispatch: (a: { id: string }) => Promise<{ ok: boolean; topicId?: string; error?: string }>;
};

export default async function autoPickupTick(): Promise<{
  picked: string | null;
  reason: string;
}> {
  // Read settings from utility's sandboxed FS.
  let settings: PickupSettings = { enabled: false, prompt: DEFAULT_PROMPT };
  try {
    const txt = await reflex.fs.read({ path: "data/settings.json" });
    if (txt) {
      const parsed = JSON.parse(txt) as Partial<PickupSettings>;
      settings = {
        enabled: !!parsed.enabled,
        prompt: typeof parsed.prompt === "string" ? parsed.prompt : DEFAULT_PROMPT,
      };
    }
  } catch {
    /* defaults */
  }
  if (!settings.enabled) {
    return { picked: null, reason: "auto-pickup disabled" };
  }

  const { tasks } = await tasksApi.list();
  const ready = tasks.filter((t) => t.status === "ready");
  const inProgress = tasks.filter((t) => t.status === "in-progress");
  if (ready.length === 0) {
    return { picked: null, reason: "no ready tasks" };
  }

  const llmPrompt = [
    settings.prompt.trim() || DEFAULT_PROMPT,
    "",
    "## READY",
    JSON.stringify(
      ready.map((t) => ({
        id: t.id,
        title: t.title,
        type: t.type,
        priority: t.priority,
        labels: t.labels,
        createdAt: t.createdAt,
      })),
      null,
      2,
    ),
    "",
    "## IN_PROGRESS",
    JSON.stringify(
      inProgress.map((t) => ({
        id: t.id,
        title: t.title,
        type: t.type,
      })),
      null,
      2,
    ),
  ].join("\n");

  const reply = await reflex.llm.complete({ task: "quick", prompt: llmPrompt });
  const text = (reply?.text ?? "").trim();
  let decision: { taskId: string | null; reason?: string } = {
    taskId: null,
    reason: "parse failed",
  };
  try {
    const m = /\{[\s\S]*\}/.exec(text);
    if (m) decision = JSON.parse(m[0]);
  } catch {
    /* leave as-is */
  }
  if (!decision.taskId) {
    return { picked: null, reason: decision.reason ?? "no candidate" };
  }
  const dispatched = await tasksApi.dispatch({ id: decision.taskId });
  if (!dispatched.ok) {
    return {
      picked: null,
      reason: `dispatch failed: ${dispatched.error ?? ""}`,
    };
  }
  return { picked: decision.taskId, reason: decision.reason ?? "" };
}
