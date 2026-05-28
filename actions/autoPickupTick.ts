import { reflex } from "@host/api";
import type { Task } from "./_types";

/**
 * Auto-pickup tick. Reads the user's `task-board-auto-pickup` settings
 * from sandboxed FS, applies the LLM-evaluated pickup prompt against the
 * available work (backlog + ready), and dispatches one task at a time.
 *
 * Candidate columns are `backlog` + `ready`: most users drop work in
 * backlog and never bother moving it to ready, so ready-only pickup
 * looked broken ("I have a backlog task but it says nothing"). Ready is
 * still preferred over backlog within the prompt.
 *
 * Designed to be wired into a Reflex workflow on a schedule. The
 * utility's settings UI registers the workflow when the toggle is on.
 */

interface PickupSettings {
  enabled: boolean;
  prompt: string;
}

const DEFAULT_PROMPT = `You are deciding which task an agent should pick up next.

Inputs you'll see:
  - AVAILABLE: tasks waiting to be worked on (status "ready" or "backlog"; prefer "ready")
  - IN_PROGRESS: tasks already being worked on

Pick ONE task (or none). Prefer "ready" over "backlog"; then priority high > normal > low; within a tier, the oldest createdAt wins. Skip tasks whose code areas obviously overlap with something IN_PROGRESS.

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
  // Candidates: ready first, then backlog — both are "available, not
  // started" work. Ordering here also hints the LLM's preference.
  const available = [
    ...tasks.filter((t) => t.status === "ready"),
    ...tasks.filter((t) => t.status === "backlog"),
  ];
  const inProgress = tasks.filter((t) => t.status === "in-progress");
  if (available.length === 0) {
    return { picked: null, reason: "no available tasks (backlog/ready empty)" };
  }

  const llmPrompt = [
    settings.prompt.trim() || DEFAULT_PROMPT,
    "",
    "## AVAILABLE",
    JSON.stringify(
      available.map((t) => ({
        id: t.id,
        title: t.title,
        type: t.type,
        status: t.status,
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
  // Guard against a hallucinated id — only dispatch a real candidate.
  if (!available.some((t) => t.id === decision.taskId)) {
    return { picked: null, reason: `picked unknown id ${decision.taskId}` };
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
