import { reflex } from "@host/api";

/**
 * Dispatch a task to an agent straight from the dashboard card's
 * "Send to agent" button. Creates the worktree + bound topic (for code
 * tasks) and flips the task to in-progress — same as the board's own
 * dispatch path, just triggered from the card.
 *
 * Args: { id } — the task id (the action-list widget passes the item id).
 */
export default async function dispatchFromCard(args: {
  id?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const id = args?.id;
  if (!id) return { ok: false, error: "no task id" };
  try {
    await reflex.tasks.dispatch({ id });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
